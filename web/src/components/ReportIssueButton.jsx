// Report Issue trigger — opens the ReportIssueModal.
// Variant 'compact' for headers, 'pill' for in-page actions.

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './ui/index.js';
import ReportIssueModal from './ReportIssueModal.jsx';

export default function ReportIssueButton({
  lockedAsset,
  onSubmitted,
  variant = 'pill', // 'pill' | 'compact'
  className,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant === 'compact' ? 'secondary' : 'danger'}
        size={variant === 'compact' ? 'sm' : 'md'}
        onClick={() => setOpen(true)}
        className={className}
      >
        <AlertCircle size={variant === 'compact' ? 14 : 16} />
        Report issue
      </Button>
      <ReportIssueModal
        open={open}
        onClose={() => setOpen(false)}
        lockedAsset={lockedAsset}
        onSubmitted={onSubmitted}
      />
    </>
  );
}
