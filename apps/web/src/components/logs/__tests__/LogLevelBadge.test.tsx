import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LogLevelBadge } from '../LogLevelBadge';

describe('LogLevelBadge', () => {
  it('renders trace with gray styles', () => {
    render(<LogLevelBadge level="trace" />);
    const badge = screen.getByText('trace');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-gray-100');
    expect(badge).toHaveClass('text-gray-600');
  });

  it('renders debug with slate styles', () => {
    render(<LogLevelBadge level="debug" />);
    const badge = screen.getByText('debug');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-slate-100');
    expect(badge).toHaveClass('text-slate-600');
  });

  it('renders info with blue styles', () => {
    render(<LogLevelBadge level="info" />);
    const badge = screen.getByText('info');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-blue-100');
    expect(badge).toHaveClass('text-blue-700');
  });

  it('renders warn with amber styles', () => {
    render(<LogLevelBadge level="warn" />);
    const badge = screen.getByText('warn');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-amber-100');
    expect(badge).toHaveClass('text-amber-700');
  });

  it('renders error with red styles', () => {
    render(<LogLevelBadge level="error" />);
    const badge = screen.getByText('error');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-red-100');
    expect(badge).toHaveClass('text-red-700');
  });

  it('renders fatal with dark red styles', () => {
    render(<LogLevelBadge level="fatal" />);
    const badge = screen.getByText('fatal');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-red-900');
    expect(badge).toHaveClass('text-red-100');
  });

  it('applies additional className', () => {
    render(<LogLevelBadge level="info" className="my-custom-class" />);
    const badge = screen.getByText('info');
    expect(badge).toHaveClass('my-custom-class');
  });

  it('always renders base badge classes', () => {
    render(<LogLevelBadge level="warn" />);
    const badge = screen.getByText('warn');
    expect(badge).toHaveClass('inline-flex');
    expect(badge).toHaveClass('rounded');
    expect(badge).toHaveClass('text-xs');
    expect(badge).toHaveClass('font-medium');
  });
});
