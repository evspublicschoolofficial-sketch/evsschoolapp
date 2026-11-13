// Teacher Performance Tracking, Monthly Leaderboard & Teacher of the Year Schema

export interface TeacherPerformanceRecord {
  id: string; // e.g. "tp_2026_09_user_123"
  teacher_id: string; // SchoolUser User_ID or unique teacher identifier
  teacher_name: string; // Teacher Full Name
  assigned_class?: string; // e.g. "Class 5", "Class 2"
  subject?: string; // e.g. "Mathematics & Science"
  month: string; // e.g. "2026-09" or "September 2026"
  academic_year: string; // e.g. "2026-2027"

  // 1. Syllabus Progress (Max 30 Points)
  // Percentage of weekly/monthly syllabus completed vs target set
  syllabus_progress_score: number; // 0 - 30
  syllabus_target_percent?: number; // e.g. 95%

  // 2. Student Test Results (Max 25 Points)
  // Average marks achieved by students in tests taught by teacher
  student_test_score: number; // 0 - 25
  test_average_percent?: number; // e.g. 82%

  // 3. Student Attendance & App Logs (Max 15 Points)
  // Punctuality and accuracy in logging daily student attendance in the app
  attendance_logging_score: number; // 0 - 15
  attendance_log_accuracy?: number; // e.g. 98%

  // 4. Homework & Notebook Evaluation (Max 15 Points)
  // Regularity in assigning and checking homework copies in app
  homework_evaluation_score: number; // 0 - 15
  homework_checked_count?: number;

  // 5. Punctuality & School Discipline (Max 15 Points)
  // On-time school arrival and classroom management
  punctuality_discipline_score: number; // 0 - 15
  punctuality_percent?: number; // e.g. 96%

  // Auto calculation metrics & provenance
  auto_metrics?: {
    is_auto_calculated: boolean;
    syllabus_topics_count?: number;
    test_marks_avg?: number;
    attendance_days_logged?: number;
    attendance_total_working_days?: number;
    homework_assigned_count?: number;
    homework_copies_checked?: number;
    punctuality_on_time_days?: number;
    punctuality_total_days?: number;
    calculation_breakdown?: string;
  };

  // Computed & Summary Fields
  monthly_total_score: number; // Sum of all 5 parameters (0 - 100)
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  rank?: number; // Rank in the month
  evaluation_date: string; // YYYY-MM-DD
  evaluated_by: string; // e.g. "Manager / Principal"
  remarks?: string; // Constructive feedback
  timestamp?: string; // ISO sync timestamp
}

export interface MonthlyLeaderboardSummary {
  month: string;
  academic_year: string;
  totalTeachersEvaluated: number;
  averageSchoolScore: number;
  topScorer: TeacherPerformanceRecord | null;
  rankings: Array<TeacherPerformanceRecord & { rank: number; percentile: number }>;
}

export interface TeacherOfTheYearResult {
  winner: {
    teacher_id: string;
    teacher_name: string;
    assigned_class?: string;
    annualAverageScore: number;
    totalMonthsEvaluated: number;
    highestMonthScore: number;
    lowestMonthScore: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D';
    bestMonth: string;
    consistencyScore: number;
    consistencyRating: string;
    records: TeacherPerformanceRecord[];
  } | null;
  allAnnualRankings: Array<{
    rank: number;
    teacher_id: string;
    teacher_name: string;
    assigned_class?: string;
    annualAverageScore: number;
    totalMonthsEvaluated: number;
    consistencyRating: string;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  }>;
  academic_year: string;
}
