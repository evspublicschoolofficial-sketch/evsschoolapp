// Shared Data Interfaces for E.V.S. Public School Portal

export interface Student {
  Student_ID: string;
  Admission_Number: string | number;
  Roll_Number: string | number;
  Student_Name: string;
  Class: string;
  Father_Name: string;
  Mother_Name: string;
  Parent_Mobile: string | number;
  Student_Photo?: string;
  Photo?: string;
  photo?: string;
  student_photo?: string;
  'Student Photo'?: string;
  'Village/rRoute'?: string;
  Village?: string;
  Balance_Amount?: number | string;
  'QR code'?: string;
  'QR_code'?: string;
  QRCode?: string;
  qr_code?: string;
  [key: string]: any;
}

export interface FeeCollectionRecord {
  Receipt_Number?: string;
  Student_ID: string;
  Date?: string;
  Fee_Type?: string;
  Month?: string;
  Total_Amount?: number | null;
  Amount_Paid?: number | null;
  Balance_Amount?: number | null;
  Payment_Mode?: string;
  Received_By?: string;
}

export interface Homework {
  Homework_ID: string;
  Date: string;
  Class: string;
  Subject: string;
  Homework_Detail: string;
  Target_Type?: string;
  Student_ID?: string;
  Homework_Photo?: string;
  Homework_Photo_2?: string;
  Homework_PDF?: string;
  Teacher?: string;
  [key: string]: any;
}

export interface HomeworkTrackerRecord {
  ID: string;
  Date: string;
  Class: string;
  Student_ID: string;
  Subject: string;
  Last_homework_Status: 'Completed' | 'Incompleted' | string;
}

export interface StudentBehaviorRecord {
  Behavior_ID: string;
  Student_ID: string;
  Date: string;
  Class: string;
  Is_Bathed: boolean;
  Nails_Clean: boolean;
  Uniform_clean: boolean;
  Good_Manners: string;
  Discipline: boolean;
  Is_Present: boolean;
  Remark: string;
  AI_Feedback?: string;
}

export interface SchoolUser {
  User_ID: string;
  Mobile_number: string | number;
  Username: string;
  Password?: string;
  Name: string;
  Designation: string;
  Assigned_Class?: string;
  Last_AI_Run?: string;
}
