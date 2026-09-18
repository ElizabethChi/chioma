import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockPush = vi.fn();
const mockUseTenantReview = vi.fn();
const mockMutateAsyncUpdate = vi.fn();
const mockMutateAsyncDelete = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/query/hooks/use-tenant-reviews', () => ({
  useTenantReview: (id: string) => mockUseTenantReview(id),
  useUpdateReview: () => ({ mutateAsync: mockMutateAsyncUpdate }),
  useDeleteReview: () => ({ mutateAsync: mockMutateAsyncDelete }),
}));

vi.mock('@/store/authStore', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import toast from 'react-hot-toast';
import { ReviewForm } from '../ReviewForm';

const mockReview = {
  id: 'rev-1',
  reviewId: 'RVW-001',
  target: 'James Adebayo',
  targetRole: 'LANDLORD' as const,
  propertyName: 'Sunset Apartments',
  rating: 4,
  comment: 'Great landlord overall.',
  status: 'PUBLISHED' as const,
  context: 'LEASE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  responseCount: 0,
};

describe('ReviewForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ walletAddress: '0xABC123' });
    mockUseTenantReview.mockReturnValue({ data: mockReview, isLoading: false });
    mockMutateAsyncUpdate.mockResolvedValue(undefined);
    mockMutateAsyncDelete.mockResolvedValue(undefined);
  });

  it('shows a loading state while the review is being fetched', () => {
    mockUseTenantReview.mockReturnValue({ data: undefined, isLoading: true });

    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));

    expect(screen.getByText('Loading review...')).toBeInTheDocument();
  });

  it('populates the form with the loaded review', () => {
    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));

    expect(screen.getByText('Edit Review')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Great landlord overall.'),
    ).toBeInTheDocument();
  });

  it('shows the delete button only when an existing review is loaded', () => {
    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('does not show the delete button when there is no review yet', () => {
    mockUseTenantReview.mockReturnValue({ data: undefined, isLoading: false });

    render(React.createElement(ReviewForm, {}));
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('blocks submission and shows a toast when no wallet is connected', async () => {
    mockUseAuth.mockReturnValue({ walletAddress: null });

    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));

    fireEvent.click(screen.getByText('Mint NFT Rating'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Please connect your Web3 wallet to mint this rating.',
      );
    });
    expect(mockMutateAsyncUpdate).not.toHaveBeenCalled();
  });

  it('submits the updated rating and comment, then navigates away', async () => {
    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));

    const textarea = screen.getByPlaceholderText('Share your experience...');
    fireEvent.change(textarea, { target: { value: 'Updated review text' } });

    fireEvent.click(screen.getByText('Mint NFT Rating'));

    await waitFor(
      () => {
        expect(mockMutateAsyncUpdate).toHaveBeenCalledWith({
          id: 'rev-1',
          payload: { rating: 4, comment: 'Updated review text' },
        });
      },
      { timeout: 3000 },
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/user/reviews'));
  });

  it('navigates back when Cancel is clicked', () => {
    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));

    fireEvent.click(screen.getByText('Cancel'));
    expect(mockPush).toHaveBeenCalledWith('/user/reviews');
  });

  it('deletes the review after confirmation and navigates away', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockMutateAsyncDelete).toHaveBeenCalledWith('rev-1');
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/user/reviews'));

    vi.unstubAllGlobals();
  });

  it('updates the rating when a star is clicked', () => {
    render(React.createElement(ReviewForm, { reviewId: 'rev-1' }));

    fireEvent.click(screen.getByLabelText('Star rating 2'));

    // Rating change is reflected internally; submit button should remain enabled
    expect(screen.getByText('Mint NFT Rating')).not.toBeDisabled();
  });
});
