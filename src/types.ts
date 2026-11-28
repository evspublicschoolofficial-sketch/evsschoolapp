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
  Session_Start_Month?: string;
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
  Discount_Amount?: number | null;
  Net_Payable?: number | null;
  Amount_Paid?: number | null;
  Balance_Amount?: number | null;
  Payment_Mode?: string;
  Received_By?: string;
  Allocations_Summary?: string;
  Notes?: string;
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
  attendance_only?: boolean;
  [key: string]: any;
}

export interface SchoolUser {
  User_ID: string;
  Mobile_number: string | number;
  Username: string;
  Password?: string;
  Name: string;
  Designation: string;
  Assigned_Class?: string;
  Assigned_Subjects?: string;
  Department?: string;
  Teacher_Photo?: string;
  Last_AI_Run?: string;
}

export interface TeacherProfileMeta {
  assigned_subjects?: string;
  department?: string;
  teacher_photo?: string;
  updated_at?: string;
  updated_by?: string;
}

export interface SchoolNotice {
  id: string;
  title: string;
  date: string;
  category: 'emergency' | 'urgent' | 'holiday' | 'exam' | 'ptm' | 'event' | 'general';
  description: string;
  targetClass?: string;
  issuedBy?: string;
  isPinned?: boolean;
  isEmergency?: boolean;
}

export interface StaffAttendanceRecord {
  id: string;
  user_id: string;
  username?: string;
  name: string;
  designation: string;
  date: string; // YYYY-MM-DD
  check_in_time: string; // e.g. "08:30 AM"
  check_out_time?: string; // e.g. "02:30 PM"
  status: 'Present' | 'Late' | 'Half-Day' | 'Absent' | 'On-Duty' | 'Leave';
  method: 'School QR Scan' | 'Manual' | 'Manager Override';
  school_code?: string;
  location?: string;
  remark?: string;
  timestamp: number;
  created_at: string;
}

export interface SyllabusTopicRecord {
  id: string; // e.g. "syl_2026_09_sunita_1"
  teacher_id: string;
  teacher_name: string;
  class_name: string;
  subject: string;
  month: string; // "2026-09"
  week_number: number; // 1, 2, 3, 4, 5
  week_label?: string; // "सप्ताह 1 (1 से 7 तारीख)"
  chapter_title: string; // e.g. "Chapter 4: भिन्न (Fractions)"
  topic_description: string; // e.g. "अभ्यास 4.1 और 4.2: भिन्नों का जोड़ व घटाव"
  planned_date: string; // YYYY-MM-DD
  target_completion_date: string; // YYYY-MM-DD
  completed_date?: string;
  status: 'Pending' | 'In_Progress' | 'Completed';
  verification_remarks?: string;
  created_at?: string;
  timestamp?: string;
}

export interface SchoolHolidayRecord {
  id: string; // e.g. "hol_2026_10_02_gandhi"
  title: string; // e.g. "गांधी जयंती (Gandhi Jayanti)"
  date: string; // YYYY-MM-DD
  end_date?: string; // Optional end date for multi-day breaks
  category: 'festival' | 'national' | 'weather' | 'order' | 'vacation';
  description?: string;
  created_by?: string;
  created_at?: string;
  timestamp?: string;
}

export interface WeeklyTestRecord {
  id: string;
  test_session_id?: string;
  teacher_id: string;
  teacher_name: string;
  class_name: string;
  subject: string;
  month: string; // YYYY-MM
  week_number: number; // 1..4
  test_date: string; // YYYY-MM-DD
  topic_name: string;
  student_id: string;
  student_name: string;
  max_marks: number;
  marks_obtained: number;
  attendance_status?: 'Present' | 'Absent';
  remarks?: string;
  timestamp?: string;
}

export interface StaffSalaryConfig {
  userId: string;
  name?: string;
  baseSalary: number;
  paidLeaveDays: number;
  lateThresholdDays: number;
  latePenaltyPerDay: number;
  lateDeductionPerMinute: number;
  halfDayFactor: number;
  overtimeHourlyRate: number;
  extraDutyDayBonus: number;
  allowances: number;
  manualDeduction: number;
  updatedAt?: string;
}

export interface UpiSettings {
  upiId: string;
  payeeName: string;
  bankName?: string;
  instructions?: string;
  staticQrImage?: string;
  updatedAt?: string;
}

export interface UpiPaymentRequest {
  id: string;
  studentId: string;
  studentName: string;
  className?: string;
  parentMobile?: string;
  payerName?: string;
  amount: number;
  feeType: string;
  month: string;
  utrNumber: string;
  paymentApp?: string;
  paymentDate: string;
  screenshotData?: string;
  notes?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  receiptNumber?: string;
  managerNote?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  createdAt: string;
}

export type ExamTermType = 'Quarterly' | 'Half-Yearly' | 'Annual';

export interface ExamMarkRecord {
  id: string;
  session: string;
  exam_type: ExamTermType;
  student_id: string;
  student_name: string;
  class_name: string;
  subject: string;
  max_marks: number;
  marks_obtained: number;
  attendance_status?: 'Present' | 'Absent';
  teacher_id?: string;
  teacher_name?: string;
  remarks?: string;
  updated_at?: string;
  approval_status?: 'pending_approval' | 'approved';
  submitted_at?: string;
}

export interface ReportCardRemarkRecord {
  reportKey: string; // e.g. "2026-27::EVS001"
  session: string;
  studentId: string;
  teacherRemark: string;
  principalRemark: string;
  resultStatus?: 'PROMOTED' | 'PASSED' | 'NEEDS IMPROVEMENT' | 'DETAINED';
  publishedToParent?: boolean;
  updatedBy?: string;
  updatedAt?: string;
  submittedBy?: string;
  submittedAt?: string;
  approvalStatus?: 'pending_approval' | 'approved' | 'rejected';
}

export interface ReportCardAccessConfig {
  allowTeacherPtmView: boolean;
  allowParentView: boolean;
  allowTeacherQrAttendance?: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export interface HallPassOverride {
  allowed: boolean;
  note?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface HallPassDatesheetRow {
  date: string;
  day: string;
  subjects: Record<string, string>;
}

export type HallPassCardLayout = 'portrait_67x96' | 'landscape_polypack_90x55' | 'landscape_full_96x67';

export interface HallPassConfig {
  examType: ExamTermType;
  session: string;
  customExamTitle?: string;
  examScheduleLine: string;
  instructionLine: string;
  publishedToParent: boolean;
  allowedOverrides: Record<string, HallPassOverride>;
  datesheetArrivalLine?: string;
  datesheetHolidayNote?: string;
  backsideFlipMode?: 'book_flip' | 'row_flip';
  cardLayout?: HallPassCardLayout;
  datesheetRows?: HallPassDatesheetRow[];
  updatedAt?: string;
}

// =========================================================================
// ACADEMICS, SESSIONS, SECTIONS, SUBJECTS & TIMETABLE ERP INTERFACES
// =========================================================================

export type WeekdayKey = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export interface AcademicSession {
  id: string; // e.g. "2026-27"
  name: string; // e.g. "Session 2026-27"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isActive: boolean;
  createdAt?: string;
}

export interface AcademicSubject {
  id: string;
  name: string;
  code: string;
  isElective?: boolean;
  colorHex?: string;
}

export interface ClassSectionConfig {
  id: string; // e.g. "C10::A"
  classKey: string; // e.g. "C10" or class name
  sectionName: string; // e.g. "A", "B"
  roomNumber?: string;
  classTeacherId?: string;
  classTeacherName?: string;
  subjectIds?: string[]; // assigned subject IDs for this class-section
  subjectTeachers?: Record<string, string>; // subjectId -> teacher User_ID
}

export interface PeriodSlot {
  id: string;
  periodNumber: number; // 1, 2, 3... (0 for lunch/break)
  label: string; // e.g. "Period 1", "Lunch Break"
  startTime: string; // "08:00"
  endTime: string; // "08:40"
  isBreak?: boolean;
}

export interface PeriodSetConfig {
  id: string;
  name: string; // e.g. "Summer Morning Shift"
  assignedClassKeys: string[]; // e.g. ["C1", "C2", ...] or ["ALL"]
  slots: PeriodSlot[];
}

export interface TimetableEntry {
  id: string; // e.g. "2026-27::C10::A::Monday::p1"
  sessionId: string;
  classKey: string;
  sectionName: string;
  day: WeekdayKey;
  periodId: string;
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  roomNumber?: string;
}

export interface TeacherSubstitution {
  id: string;
  sessionId: string;
  date: string; // YYYY-MM-DD
  day: WeekdayKey;
  periodId: string;
  periodLabel: string;
  classKey: string;
  sectionName: string;
  subjectName: string;
  originalTeacherId: string;
  originalTeacherName: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
  reason?: string;
  createdAt?: string;
}

export interface StudentAcademicOverride {
  studentId: string;
  classKey: string;
  sectionName: string;
  sessionId: string;
  status: 'Active' | 'Promoted' | 'Detained' | 'Passout';
  updatedAt?: string;
}

export interface PromotionLogEntry {
  id: string;
  fromSession: string;
  toSession: string;
  fromClass: string;
  fromSection: string;
  toClass: string;
  toSection: string;
  studentCount: number;
  studentIds: string[];
  actionType: 'Promote' | 'Detain' | 'Passout';
  performedBy: string;
  performedAt: string;
}

export interface AcademicsConfigSnapshot {
  sessions: AcademicSession[];
  activeSessionId: string;
  subjects: AcademicSubject[];
  sections: ClassSectionConfig[];
  periodSets: PeriodSetConfig[];
  timetable: TimetableEntry[];
  substitutions: TeacherSubstitution[];
  studentOverrides: Record<string, StudentAcademicOverride>;
  promotionLogs: PromotionLogEntry[];
  updatedAt?: string;
  updatedBy?: string;
}

export type FeePromiseStatus = 'Pending' | 'Fulfilled' | 'Overdue' | 'Cancelled';

export interface FeePromiseRecord {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  fatherName?: string;
  parentMobile: string;
  totalDueAtPromise: number;
  promisedAmount: number;
  promisedDate: string; // YYYY-MM-DD
  notes?: string;
  status: FeePromiseStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  fulfilledAt?: string;
  lastRemindedDate?: string; // YYYY-MM-DD
}
