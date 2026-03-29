export interface StudentRow {
  studentName: string;
  parentEmail: string;
  dropOffTime: string;
  pickUpTime: string;
  totalHours: string | number;
}

export interface RowWarning {
  row: number;
  field: string;
  message: string;
}

export interface SendResult {
  email: string;
  studentName: string;
  status: 'sent' | 'error';
  error?: string;
}
