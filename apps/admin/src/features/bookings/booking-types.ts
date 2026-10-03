export type Period = { day: number; start: string; end: string };
export type Exception = {
  date: string;
  periods: Array<{ start: string; end: string }>;
};
export type Professional = {
  id: string;
  principalId: string;
  enabled: boolean;
  weekly: Period[];
  exceptions: Exception[];
};
export type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  bufferMinutes: number;
  enabled: boolean;
  professionalIds: string[];
};
export type Settings = {
  version: number;
  enabled: boolean;
  published: boolean;
  title: string;
  description: string;
  timeZone: string;
  leadMinutes: number;
  horizonDays: number;
  cancellationMinutes: number;
  reminderMinutes: number;
  services: Service[];
  professionals: Professional[];
};
export type Candidate = { principalId: string; displayName: string };
