'use client';

import { useState } from 'react';
import { Button } from '@eyesinvest/ui';
import { BulkImportDialog } from './BulkImportDialog';

/**
 * Tiny client wrapper that owns the dialog's open state. Used by the
 * server-rendered /stocks page header so we don't have to make the whole
 * page client-side.
 */
export function BulkImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        Bulk import
      </Button>
      <BulkImportDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
