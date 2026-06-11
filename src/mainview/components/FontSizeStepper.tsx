// Diff font-size stepper (− 13px +), shared by the settings dialog and the
// toolbar's font-size popover so both clamp and render identically.

import { Minus, Plus } from 'lucide-react';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../shared/config';
import { useReviewStore } from '../store';
import { Button } from './ui/button';

export function FontSizeStepper() {
  const fontSize = useReviewStore((state) => state.fontSize);
  const setFontSize = useReviewStore((state) => state.setFontSize);

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Decrease font size"
        disabled={fontSize <= FONT_SIZE_MIN}
        onClick={() => setFontSize(fontSize - 1)}
      >
        <Minus />
      </Button>
      <span className="w-10 text-center font-mono text-xs tabular-nums">{fontSize}px</span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Increase font size"
        disabled={fontSize >= FONT_SIZE_MAX}
        onClick={() => setFontSize(fontSize + 1)}
      >
        <Plus />
      </Button>
    </div>
  );
}
