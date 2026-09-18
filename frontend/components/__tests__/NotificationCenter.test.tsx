import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import type { Notification } from '@/types/notification';

vi.mock('@/lib/services/notification.service', () => ({
  notificationService: {
    getNotifications: vi.fn(),
    getUnreadCount: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
  },
}));

import NotificationCenter from '../NotificationCenter';
import { notificationService } from '@/lib/services/notification.service';

const notifications: Notification[] = [
  {
    id: 'n1',
    title: 'Payment received',
    message: 'Your rent payment was received.',
    isRead: false,
    type: 'success',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n2',
    title: 'Maintenance update',
    message: 'A technician was assigned to your request.',
    isRead: true,
    type: 'info',
    createdAt: new Date().toISOString(),
  },
];

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      notificationService.getNotifications as ReturnType<typeof vi.fn>
    ).mockResolvedValue(notifications);
    (
      notificationService.getUnreadCount as ReturnType<typeof vi.fn>
    ).mockResolvedValue(1);
  });

  it('renders the bell button with an unread badge', async () => {
    render(React.createElement(NotificationCenter));

    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('opens the panel and lists notifications on click', async () => {
    render(React.createElement(NotificationCenter));

    await screen.findByText('1');
    fireEvent.click(screen.getByLabelText('Notifications'));

    expect(await screen.findByText('Payment received')).toBeInTheDocument();
    expect(screen.getByText('Maintenance update')).toBeInTheDocument();
    expect(screen.getByText('Unread (1)')).toBeInTheDocument();
  });

  it('shows an empty state when there are no notifications', async () => {
    (
      notificationService.getNotifications as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (
      notificationService.getUnreadCount as ReturnType<typeof vi.fn>
    ).mockResolvedValue(0);

    render(React.createElement(NotificationCenter));

    fireEvent.click(screen.getByLabelText('Notifications'));

    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });

  it('marks a single notification as read', async () => {
    (
      notificationService.markAsRead as ReturnType<typeof vi.fn>
    ).mockResolvedValue(undefined);

    render(React.createElement(NotificationCenter));
    await screen.findByText('1');
    fireEvent.click(screen.getByLabelText('Notifications'));

    const unreadCard = (await screen.findByText('Payment received')).closest(
      'div.p-4',
    ) as HTMLElement;
    fireEvent.click(within(unreadCard).getByText('Mark as read'));

    expect(notificationService.markAsRead).toHaveBeenCalledWith('n1');
    await waitFor(() =>
      expect(
        within(unreadCard).queryByText('Mark as read'),
      ).not.toBeInTheDocument(),
    );
  });

  it('marks all notifications as read via the footer action', async () => {
    (
      notificationService.markAllAsRead as ReturnType<typeof vi.fn>
    ).mockResolvedValue(undefined);

    render(React.createElement(NotificationCenter));
    await screen.findByText('1');
    fireEvent.click(screen.getByLabelText('Notifications'));

    await screen.findByText('Payment received');
    fireEvent.click(screen.getByText('Mark all as read'));

    expect(notificationService.markAllAsRead).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText('Mark as read')).not.toBeInTheDocument(),
    );
  });

  it('deletes a notification from the list', async () => {
    (
      notificationService.deleteNotification as ReturnType<typeof vi.fn>
    ).mockResolvedValue(undefined);

    render(React.createElement(NotificationCenter));
    await screen.findByText('1');
    fireEvent.click(screen.getByLabelText('Notifications'));

    await screen.findByText('Payment received');
    fireEvent.click(screen.getAllByText('Delete')[0]);

    expect(notificationService.deleteNotification).toHaveBeenCalledWith('n1');
  });

  it('switches to the unread filter and reloads notifications', async () => {
    render(React.createElement(NotificationCenter));
    await screen.findByText('1');
    fireEvent.click(screen.getByLabelText('Notifications'));
    await screen.findByText('Payment received');

    (notificationService.getNotifications as ReturnType<typeof vi.fn>)
      .mockClear()
      .mockResolvedValue([notifications[0]]);

    fireEvent.click(screen.getByText('Unread (1)'));

    expect(notificationService.getNotifications).toHaveBeenCalledWith({
      isRead: false,
    });
  });

  it('closes the panel when the close button is clicked', async () => {
    render(React.createElement(NotificationCenter));
    await screen.findByText('1');
    fireEvent.click(screen.getByLabelText('Notifications'));

    await screen.findByText('Payment received');

    const closeButtons = screen.getAllByRole('button');
    const closeButton = closeButtons.find(
      (button) => button.querySelector('.lucide-x') !== null,
    );
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton as HTMLElement);

    expect(screen.queryByText('Payment received')).not.toBeInTheDocument();
  });
});
