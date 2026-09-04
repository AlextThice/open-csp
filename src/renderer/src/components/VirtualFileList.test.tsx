import { fireEvent, render, screen } from '@testing-library/react';
import type { LocalDirectoryEntry } from '@shared/ipc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { VirtualFileList } from './VirtualFileList';

describe('VirtualFileList', () => {
  it('keeps a 100,000-entry directory virtualized and interactive', () => {
    const entries: LocalDirectoryEntry[] = Array.from({ length: 100_000 }, (_, index) => ({
      kind: 'file',
      modifiedAt: '2026-08-30T12:00:00.000Z',
      name: `file-${String(index).padStart(6, '0')}.bin`,
      path: `C:\\fixture\\file-${index}.bin`,
      size: BigInt(index),
    }));

    render(<VirtualFileList entries={entries} onOpenDirectory={vi.fn()} />);

    expect(screen.getAllByTestId('file-row').length).toBeLessThan(40);
    expect(screen.getByTestId('file-list-canvas').style.height).toBe('3600000px');
    expect(screen.getByText('file-000000.bin')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sort Name descending' }));

    expect(screen.getByText('file-099999.bin')).toBeTruthy();
    expect(screen.getAllByTestId('file-row').length).toBeLessThan(40);
  });
});
