import { create } from 'zustand';

/**
 * The shell's two menus (1.42.0): the Create sheet raised by the Create tab, and the profile menu opened from the
 * picture at the top left of Stream, Search and Library. Only one is open at a time.
 */
interface ShellMenuState {
  createOpen: boolean;
  profileOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  setProfileOpen: (open: boolean) => void;
}

export const useShellMenuStore = create<ShellMenuState>(set => ({
  createOpen: false,
  profileOpen: false,
  setCreateOpen: open => set(open ? { createOpen: true, profileOpen: false } : { createOpen: false }),
  setProfileOpen: open => set(open ? { profileOpen: true, createOpen: false } : { profileOpen: false }),
}));
