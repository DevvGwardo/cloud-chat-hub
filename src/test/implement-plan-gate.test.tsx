import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementPlanGate } from '@/components/chat/ImplementPlanGate';
import { useChatStore } from '@/stores/chat-store';

beforeEach(() => {
  useChatStore.setState({ planGatePrompt: null });
});

afterEach(() => {
  cleanup();
  useChatStore.setState({ planGatePrompt: null });
});

describe('ImplementPlanGate', () => {
  it('renders nothing while no plan gate prompt is pending', () => {
    const { container } = render(<ImplementPlanGate onImplement={vi.fn()} onCancel={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the question and three actions when a prompt is pending', () => {
    useChatStore.setState({ planGatePrompt: 'Refactor the retry loop.' });
    render(<ImplementPlanGate onImplement={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Implement this plan?')).toBeTruthy();
    expect(screen.getByText('Refactor the retry loop.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, implement' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear context & implement' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No, stay in plan mode' })).toBeTruthy();
  });

  it('forwards the clear-context flag on "Yes, implement"', () => {
    useChatStore.setState({ planGatePrompt: 'Refactor the retry loop.' });
    const onImplement = vi.fn();
    render(<ImplementPlanGate onImplement={onImplement} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, implement' }));
    expect(onImplement).toHaveBeenCalledWith(false);
  });

  it('forwards clearContext=true on "Clear context & implement"', () => {
    useChatStore.setState({ planGatePrompt: 'Refactor the retry loop.' });
    const onImplement = vi.fn();
    render(<ImplementPlanGate onImplement={onImplement} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear context & implement' }));
    expect(onImplement).toHaveBeenCalledWith(true);
  });

  it('calls onCancel for "No, stay in plan mode"', () => {
    useChatStore.setState({ planGatePrompt: 'Refactor the retry loop.' });
    const onCancel = vi.fn();
    render(<ImplementPlanGate onImplement={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'No, stay in plan mode' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith();
  });
});
