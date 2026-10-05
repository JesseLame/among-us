import { createContext, useContext } from 'react';
import type { ThemeId } from '.';

export const ThemeContext = createContext<ThemeId>('classic');
export const useTheme = () => useContext(ThemeContext);
