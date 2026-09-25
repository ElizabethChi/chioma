'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth, type User } from '@/store/authStore';
import {
  initializeStellarWalletsKit,
  StellarWalletsKit,
} from '@/lib/stellar-wallets-kit';
import toast from 'react-hot-toast';
import { requestChallenge, verifySignature } from '@/lib/stellar-auth';
import {
  getConfiguredNetwork,
  getNetworkLabel,
  getNetworkPassphrase,
  matchWalletNetwork,
} from '@/lib/stellar-network';
import { detectRoleFromWallet } from '@/lib/navigation/detect-user-role';
import { clearEmailOnboardingSkip } from '@/hooks/useOnboardingGate';

interface WalletConnectButtonProps {
  onSuccess?: () => void;
  className?: string;
  buttonText?: string;
}

/**
 * The kit throws `{ code: -1, message: 'The user closed the modal.' }` (or
 * similar wording) when the picker is dismissed without selecting a wallet,
 * and wallet extensions throw their own "user rejected" style errors when
 * the sign request is declined. Both are a deliberate no-op, not a failure.
 */
function isUserDismissal(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code?: number }).code === -1) return true;
    if ((error as { code?: number }).code === -4) return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '';

  const normalized = message.toLowerCase();
  return (
    normalized.includes('closed the modal') ||
    normalized.includes('cancelled') ||
    normalized.includes('canceled') ||
    normalized.includes('reject') ||
    normalized.includes('user denied')
  );
}

export default function WalletConnectButton({
  onSuccess,
  className = '',
  buttonText = 'Connect Wallet',
}: WalletConnectButtonProps) {
  const router = useRouter();
  const { setTokens, setWalletAddress } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleWalletConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);

    try {
      initializeStellarWalletsKit();

      // If a wallet is already active in the kit (e.g. it stayed connected
      // across a reload), reuse it. Otherwise open the picker and wait for
      // the user to actually finish selecting one — calling getAddress()
      // before that resolves throws "No wallet has been connected", which
      // is why the previous implementation (hijacking the kit's own button
      // click) failed on every first-time connect.
      let address: string;
      try {
        ({ address } = await StellarWalletsKit.getAddress());
      } catch {
        ({ address } = await StellarWalletsKit.authModal());
      }

      if (!address) {
        throw new Error('Failed to get wallet address');
      }

      // Get Challenge
      toast.loading('Getting authentication challenge...', {
        id: 'wallet-challenge',
      });
      const challengeXdr = await requestChallenge(address);
      toast.dismiss('wallet-challenge');

      // Verify the wallet is actually on the network this app is configured
      // for before asking it to sign anything. Every module in the kit
      // implements `getNetwork()` (it's a required part of `ModuleInterface`,
      // not Freighter-specific), but some wallets — Albedo and xBull, at
      // least — always reject it as unsupported. Signing is blocked in that
      // "undetermined" case too: this check exists specifically to prevent
      // an expensive mistake (signing a real transaction thinking it's a
      // test one, or vice versa), so an inability to verify is treated the
      // same as a verified mismatch rather than silently let through.
      let walletNetwork: { network: string; networkPassphrase: string } | null;
      try {
        walletNetwork = await StellarWalletsKit.getNetwork();
      } catch {
        walletNetwork = null;
      }

      const networkMatch = matchWalletNetwork(walletNetwork);
      if (networkMatch.status !== 'match') {
        toast.dismiss('wallet-challenge');
        const configuredLabel = getNetworkLabel(getConfiguredNetwork());
        const message =
          networkMatch.status === 'mismatch'
            ? `Your wallet is connected to ${networkMatch.walletNetworkLabel}, but this app is configured for ${configuredLabel}. Switch your wallet's network before signing.`
            : `Could not verify your wallet's network. This app is configured for ${configuredLabel} — please confirm your wallet is on the same network before signing.`;
        toast.error(message);
        return;
      }

      // Sign Challenge
      toast.loading('Please sign the transaction in your wallet...', {
        id: 'wallet-sign',
      });

      const { signedTxXdr } = await StellarWalletsKit.signTransaction(
        challengeXdr,
        {
          networkPassphrase: getNetworkPassphrase(),
          address,
        },
      );
      toast.dismiss('wallet-sign');

      // Verify Signature
      toast.loading('Verifying authentication...', { id: 'wallet-verify' });
      const result = await verifySignature(address, challengeXdr, signedTxXdr);
      toast.dismiss('wallet-verify');

      // Manage session state. A refresh token is optional — some auth
      // backends only issue an access token — so it must not gate the
      // session, otherwise a valid login is discarded as malformed.
      if (result.accessToken && result.user) {
        // Wallet-only accounts have no name on file yet — the backend
        // returns firstName/lastName as null rather than ''. Every other
        // login path (password, OAuth) normalizes these before setTokens;
        // do the same here so consumers that index user.firstName[0]
        // (e.g. the navbar avatar initial) don't crash on null.
        const rawUser = result.user;
        let userRole = rawUser.role;

        // Use the role from the backend response directly
        // The backend already determines the role based on the wallet address
        if (!userRole) {
          // Only detect role if backend didn't provide one (shouldn't happen)
          toast.loading('Detecting user role...', { id: 'role-detect' });
          const detectedRole = await detectRoleFromWallet(address);
          toast.dismiss('role-detect');

          if (detectedRole) {
            userRole = detectedRole === 'agent' ? 'agent' : 'user';
          } else {
            // No role found - this shouldn't happen in production
            // but handle gracefully
            toast.error('Unable to determine your role. Please try again.');
            setIsConnecting(false);
            return;
          }
        }

        const userWithRole: User = {
          id: rawUser.id,
          email: rawUser.email ?? '',
          emailVerified: rawUser.emailVerified ?? false,
          firstName: rawUser.firstName ?? '',
          lastName: rawUser.lastName ?? '',
          avatar: rawUser.avatar,
          locale: rawUser.locale,
          role: (userRole as 'admin' | 'user' | 'agent') ?? 'user',
        };

        setTokens(result.accessToken, result.refreshToken ?? '', userWithRole);
        setWalletAddress(address);
        // A deliberate reconnect starts the onboarding prompt fresh.
        clearEmailOnboardingSkip();
        toast.success('Successfully logged in with Wallet!');

        if (onSuccess) {
          onSuccess();
        } else {
          // Always land on the dashboard. Accounts with no email yet are
          // prompted there by WalletEmailBanner rather than being blocked.
          const isAdmin = ['admin', 'super_admin'].includes(
            userWithRole.role?.toLowerCase() || '',
          );
          const dashboardRoute = isAdmin ? '/admin' : '/user';
          router.push(dashboardRoute);
        }
      } else {
        throw new Error('Invalid authentication response');
      }
    } catch (error: unknown) {
      toast.dismiss('wallet-challenge');
      toast.dismiss('wallet-sign');
      toast.dismiss('wallet-verify');

      if (!isUserDismissal(error)) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        toast.error(errorMessage || 'Wallet connection failed');
        console.error('Wallet connect error:', error);
      }
      // Silently ignore user rejections / dismissed modals
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleWalletConnect}
      disabled={isConnecting}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium transition-colors ${className}`}
    >
      {isConnecting && <Loader2 size={16} className="animate-spin" />}
      {isConnecting ? 'Connecting…' : buttonText}
    </button>
  );
}
