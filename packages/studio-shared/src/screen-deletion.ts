export type ScreenDeletionPreview = {
  root: string;
  screens: Array<{
    name: string;
    label: string;
    recordCount: number;
    blockedReason: string | null;
  }>;
  totalRecords: number;
  token: string;
};
