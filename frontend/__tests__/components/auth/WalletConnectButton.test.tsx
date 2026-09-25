import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WalletConnectButton from '@/components/auth/WalletConnectButton';
import { useAuth } from '@/store/authStore';
import {
  initializeStellarWalletsKit,
  StellarWalletsKit,
} from '@/lib/stellar-wallets-kit';
import { verifySignature } from '@/lib/stellar-auth';

// ─── Mocks ───────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted so variables must be defined inside them.

const routerPush = vi.fn();
const setTokens = vi.fn();
const setWalletAddress = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@/store/authStore', () => ({
  useAuth: vi.fn(() => ({
    setTokens,
    setWalletAddress,
  })),
}));

vi.mock('@/lib/stellar-wallets-kit', () => ({
  initializeStellarWalletsKit: vi.fn(),
  StellarWalletsKit: {
    getAddress: vi.fn(),
    authModal: vi.fn(),
    getNetwork: vi.fn(),
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: 'signed-xdr' }),
  },
}));

vi.mock('@/lib/stellar-auth', () => ({
  requestChallenge: vi.fn().mockResolvedValue('challenge-xdr'),
  verifySignature: vi.fn().mockResolvedValue({
    accessToken: 'token',
    refreshToken: 'refresh',
    user: { id: '1', email: 'test@test.com', role: 'user' },
  }),
}));

vi.mock('@/lib/stellar-network', () => ({
  getConfiguredNetwork: vi.fn().mockReturnValue('TESTNET'),
  getNetworkLabel: vi.fn((n: string) => (n === 'PUBLIC' ? 'Mainnet' : 'Testnet')),
  getNetworkPassphrase: vi.fn().mockReturnValue('Test Network'),
  matchWalletNetwork: vi.fn(
    (walletNetwork: { network: string; networkPassphrase: string } | null) => {
      if (!walletNetwork) return { status: 'undetermined' };
      if (walletNetwork.networkPassphrase === 'Test Network') {
        return { status: 'match' };
      }
      return {
        status: 'mismatch',
        walletNetworkLabel: walletNetwork.network || 'a different network',
      };
    },
  ),
}));

vi.mock('@/lib/navigation/detect-user-role', () => ({
  detectRoleFromWallet: vi.fn().mockResolvedValue('user'),
}));

vi.mock('@/hooks/useOnboardingGate', () => ({
  clearEmailOnboardingSkip: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    loading: vi.fn(),
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WalletConnectButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ setTokens, setWalletAddress } as any);
    vi.mocked(StellarWalletsKit.getAddress).mockRejectedValue({
      code: -1,
      message: 'No wallet has been connected.',
    });
    vi.mocked(StellarWalletsKit.authModal).mockResolvedValue({
      address: 'GABC123',
    });
    vi.mocked(StellarWalletsKit.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test Network',
    });
  });

  it('renders a button with the default label', () => {
    render(<WalletConnectButton />);
    expect(
      screen.getByRole('button', { name: /connect wallet/i }),
    ).toBeInTheDocument();
  });

  it('honors a custom buttonText prop', () => {
    render(<WalletConnectButton buttonText="Connect Stellar Wallet" />);
    expect(
      screen.getByRole('button', { name: /connect stellar wallet/i }),
    ).toBeInTheDocument();
  });

  it('applies a custom className prop to the button', () => {
    render(<WalletConnectButton className="custom-class" />);
    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });

  it('initializes the kit on click', async () => {
    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(initializeStellarWalletsKit).toHaveBeenCalled());
  });

  it('opens the picker modal when no wallet is already connected, then completes login and redirects to the dashboard', async () => {
    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(StellarWalletsKit.authModal).toHaveBeenCalled());
    await waitFor(() =>
      expect(verifySignature).toHaveBeenCalledWith(
        'GABC123',
        'challenge-xdr',
        'signed-xdr',
      ),
    );
    await waitFor(() =>
      expect(setTokens).toHaveBeenCalledWith('token', 'refresh', {
        id: '1',
        email: 'test@test.com',
        role: 'user',
        firstName: '',
        lastName: '',
        emailVerified: false,
        avatar: undefined,
        locale: undefined,
      }),
    );
    expect(setWalletAddress).toHaveBeenCalledWith('GABC123');
    expect(routerPush).toHaveBeenCalledWith('/user');
  });

  it('reuses an already-connected wallet without reopening the picker', async () => {
    vi.mocked(StellarWalletsKit.getAddress).mockResolvedValue({
      address: 'GXYZ789',
    });

    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(setWalletAddress).toHaveBeenCalledWith('GXYZ789'),
    );
    expect(StellarWalletsKit.authModal).not.toHaveBeenCalled();
  });

  it('normalizes a wallet-only account with no name on file to empty strings, not null', async () => {
    vi.mocked(verifySignature).mockResolvedValueOnce({
      accessToken: 'token',
      refreshToken: 'refresh',
      user: {
        id: '1',
        email: null,
        firstName: null,
        lastName: null,
        role: 'user',
      },
    });

    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(setTokens).toHaveBeenCalledWith(
        'token',
        'refresh',
        expect.objectContaining({ firstName: '', lastName: '' }),
      ),
    );
  });

  it('redirects admins to /admin', async () => {
    vi.mocked(verifySignature).mockResolvedValueOnce({
      accessToken: 'token',
      refreshToken: 'refresh',
      user: { id: '1', email: 'admin@test.com', role: 'admin' },
    });

    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/admin'));
  });

  it('calls onSuccess instead of redirecting when provided', async () => {
    const onSuccess = vi.fn();
    render(<WalletConnectButton onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('silently ignores the user closing the picker without an error toast', async () => {
    vi.mocked(StellarWalletsKit.authModal).mockRejectedValue({
      code: -1,
      message: 'The user closed the modal.',
    });
    const toast = (await import('react-hot-toast')).default;

    render(<WalletConnectButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(setTokens).not.toHaveBeenCalled();
  });

  describe('network mismatch guard', () => {
    it('proceeds to sign when the wallet network matches the configured network', async () => {
      render(<WalletConnectButton />);
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() =>
        expect(StellarWalletsKit.signTransaction).toHaveBeenCalled(),
      );
      expect(setTokens).toHaveBeenCalled();
    });

    it('blocks signing and shows an explanatory error on a detected network mismatch', async () => {
      vi.mocked(StellarWalletsKit.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      });
      const toast = (await import('react-hot-toast')).default;

      render(<WalletConnectButton />);
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Your wallet is connected to PUBLIC, but this app is configured for Testnet. Switch your wallet's network before signing.",
        ),
      );
      expect(StellarWalletsKit.signTransaction).not.toHaveBeenCalled();
      expect(setTokens).not.toHaveBeenCalled();
    });

    it('blocks signing with a verification-failure message when the wallet does not support getNetwork (e.g. Albedo, xBull)', async () => {
      vi.mocked(StellarWalletsKit.getNetwork).mockRejectedValue({
        code: -3,
        message: 'Albedo does not support the "getNetwork" function',
      });
      const toast = (await import('react-hot-toast')).default;

      render(<WalletConnectButton />);
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Could not verify your wallet's network. This app is configured for Testnet — please confirm your wallet is on the same network before signing.",
        ),
      );
      expect(StellarWalletsKit.signTransaction).not.toHaveBeenCalled();
      expect(setTokens).not.toHaveBeenCalled();
    });

    it('re-enables the connect button after blocking on a mismatch', async () => {
      vi.mocked(StellarWalletsKit.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      });

      render(<WalletConnectButton />);
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
    });
  });
});
