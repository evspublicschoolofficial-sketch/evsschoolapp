export type AppLanguage = 'en' | 'hi';

export const getStoredLanguage = (): AppLanguage => {
  try {
    const saved = localStorage.getItem('evs_school_lang');
    if (saved === 'hi' || saved === 'en') return saved;
  } catch {}
  return 'en'; // Default to English for English Medium School
};

export const setStoredLanguage = (lang: AppLanguage) => {
  try {
    localStorage.setItem('evs_school_lang', lang);
  } catch {}
};

export const TRANSLATIONS = {
  en: {
    // Top Bar & Brand
    schoolTitle: 'E.V.S. Public School',
    schoolTagline: 'Inspiring Knowledge • Building Character • Shaping Futures',
    officialBadge: 'Official',
    englishMediumBadge: 'English Medium',
    logout: 'Logout',
    roleSelection: 'Role Selection',
    dataSync: 'Data Sync',
    syncing: 'Syncing live data...',
    lastSync: 'Last Sync',
    installApp: 'Install App',
    backToRoles: '← Back to Roles',
    changeRole: 'Change Role',
    refreshData: 'Refresh Live Data',

    // Role Selection
    whoAreYou: 'Welcome to E.V.S. Public School',
    selectRole: 'Select Your User Role',
    selectRoleDesc: 'Please choose your role below to access your designated school portal.',
    registeredStudents: 'Registered Students',
    homeworkRecords: 'Homework Records',
    vanTransport: 'Van Transport',
    quickPortalLogin: 'Quick School Portal Login',
    defaultSelected: 'Default Selected',
    chooseRoleLabel: 'Choose Your Portal Role:',
    parentRole: '👨‍👩‍👦 1. Parent / Guardian (Default)',
    teacherRole: '👩‍🏫 2. Faculty / Teacher',
    managerRole: '👔 3. School Manager / Admin',
    driverRole: '🚐 4. School Van Driver',

    // Parent Login & Portal
    parentLoginDesc: 'Parents can directly log in using their 10-digit registered mobile number to view homework, attendance, fees, and teacher remarks.',
    parentMobileLabel: 'Registered Mobile Number or Student ID:',
    parentMobilePlaceholder: 'Enter 10-digit mobile number (e.g. 9876543210)',
    parentFetchDataBtn: 'Access Child Portal',
    parentFetchingData: 'Fetching Records...',
    parentSecurityNote: 'Only registered parents can view student data using their registered phone number.',
    parentChildFound: 'Child Profile Verified',
    switchChild: 'Switch Child',

    // Parent 4 Main Cards
    dailyHomeworkCardTitle: 'Daily Homework & Tasks',
    dailyHomeworkCardDesc: 'View homework, notes, and study material assigned by teachers.',
    homeworkCheckerCardTitle: 'Homework Evaluation & Tracker',
    homeworkCheckerCardDesc: 'Check daily submission status, completion records, and teacher checks.',
    conductCardTitle: 'Daily Conduct & Discipline',
    conductCardDesc: 'Monitor daily attendance, cleanliness, grooming, and manners.',
    feesCardTitle: 'School Fees & Receipts',
    feesCardDesc: 'View session fee breakdown, payment history, and download official receipts.',
    vanTrackerCardTitle: 'Live Van GPS Tracking',
    vanTrackerCardDesc: 'Track school van live location, route stops, and estimated arrival time.',
    noticeBoardCardTitle: 'School Notice Board',
    noticeBoardCardDesc: 'Stay updated with circulars, holiday notices, and school announcements.',

    // Teacher Login & Portal
    teacherLoginTitle: 'Teacher / Faculty Login',
    teacherLoginDesc: 'Enter teacher username/ID and password to access teaching tools.',
    teacherUserIdLabel: 'Teacher Username or ID:',
    teacherPasswordLabel: 'Password:',
    teacherLoginBtn: 'Login to Teacher Portal',
    teacherLoggingIn: 'Verifying Credentials...',
    teacherAssignedClass: 'Assigned Classes',
    staffAttendanceBadge: 'Staff Attendance',
    staffPresent: '✓ Present',
    staffCheckInNeeded: 'Check-In',
    schoolQrPoster: 'School QR Poster',
    qrCheckIn: '📷 School QR Check-In',
    qrCheckOut: '🚪 School Check-Out',
    teacherDataRefreshed: 'Data Refreshed',

    // Teacher Sub-Navigation Tabs
    tabStaffAttendance: 'Staff Attendance',
    tabUploadHomework: 'Upload Homework',
    tabHomeworkChecker: 'Check HW & Tracker',
    tabRecentSubmissions: 'Recent Assignments',
    tabDailyConduct: 'Daily Conduct & Attendance',
    tabSchoolNotices: 'Notice Board',
    tabFindStudent: 'Find Student / QR Scanner',

    // Classroom Conduct & Attendance
    bulkRegisterTab: '📋 Classroom Attendance & Conduct Register',
    historyTab: '📜 Recorded History',
    markPresent: 'Present',
    markAbsent: 'Absent',
    bathed: 'Bathed',
    uniformClean: 'Clean Uniform',
    nailsClean: 'Nails Trimmed',
    disciplineGood: 'Good Manners',
    disciplineImprove: 'Needs Improvement',
    saveBatchBtn: 'Save Register for Class',
    savingRegister: 'Saving Register...',
    todayAttendanceCompleted: 'Attendance Completed Today',

    // Manager Portal
    managerLoginTitle: 'School Administration Login',
    managerLoginDesc: 'Enter manager username and password to access school administrative records.',
    managerPortalTitle: 'Manager Administration Portal',
    cardTotalStudents: 'Total Students',
    cardFeeCollections: 'Total Fee Collections',
    cardPendingDues: 'Pending Dues / Defaulters',
    cardTodayAttendance: 'Today Attendance',
    managerTabStudents: 'All Students Records',
    managerTabHomework: 'Homework Submissions',
    managerTabBehavior: 'Behavior & Conduct Logs',
    managerTabFees: 'Fee Collection & Accounts',
    managerTabUsers: 'Staff & Faculty Accounts',
    managerTabVan: 'Live Van GPS Tracker',
    addStudentBtn: 'Add New Student',
    collectFeeBtn: 'Collect Fee',

    // Fees & Receipts
    feeSummaryTitle: 'School Fees & Receipts',
    totalSessionFee: 'Total Session Fee',
    totalPaid: 'Total Paid Amount',
    pendingBalance: 'Pending Balance',
    advancePaid: 'Advance Paid',
    feeStatusDue: 'PAYMENT DUE',
    feeStatusCleared: 'CLEARED / NIL',
    feeStatusAdvance: 'ADVANCE PAID',
    receiptNumber: 'Receipt No.',
    paymentMode: 'Payment Mode',
    printReceipt: 'Print Official Receipt',

    // Common & Alerts
    present: 'Present',
    absent: 'Absent',
    viewDetails: 'View Details',
    close: 'Close',
    searchPlaceholder: 'Search by student name, ID, or roll number...',
    allClasses: 'All Classes',
    class: 'Class',
    date: 'Date',
    status: 'Status',
    actions: 'Actions',
    yes: 'Yes',
    no: 'No',
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading...'
  },
  hi: {
    // Top Bar & Brand
    schoolTitle: 'E.V.S. Public School',
    schoolTagline: 'Inspiring Knowledge • Building Character • Shaping Futures',
    officialBadge: 'आधिकारिक',
    englishMediumBadge: 'इंग्लिश मीडियम',
    logout: 'लॉगआउट',
    roleSelection: 'भूमिका चयन',
    dataSync: 'डेटा सिंक',
    syncing: 'डेटा सिंक हो रहा है...',
    lastSync: 'अंतिम सिंक',
    installApp: 'ऐप इंस्टॉल',
    backToRoles: '← वापस जाएं',
    changeRole: 'भूमिका बदलें',
    refreshData: 'डेटा रिफ्रेश करें',

    // Role Selection
    whoAreYou: 'ई.वी.एस. पब्लिक स्कूल में आपका स्वागत है',
    selectRole: 'अपनी भूमिका का चयन करें',
    selectRoleDesc: 'कृपया जारी रखने के लिए नीचे दिए गए विकल्पों में से अपनी भूमिका का चयन करें।',
    registeredStudents: 'पंजीकृत छात्र',
    homeworkRecords: 'होमवर्क रिकॉर्ड्स',
    vanTransport: 'वैन ट्रांसपोर्ट',
    quickPortalLogin: 'स्कूल पोर्टल त्वरित लॉगिन',
    defaultSelected: 'डिफ़ॉल्ट सिलेक्टेड',
    chooseRoleLabel: 'अपनी भूमिका का चयन करें:',
    parentRole: '👨‍👩‍👦 1. अभिभावक (Parent) — [डिफ़ॉल्ट]',
    teacherRole: '👩‍🏫 2. शिक्षक (Teacher)',
    managerRole: '👔 3. स्कूल प्रबंधक (Manager / Admin)',
    driverRole: '🚐 4. वैन चालक (Van Driver)',

    // Parent Login & Portal
    parentLoginDesc: 'अभिभावक केवल अपना रजिस्टर्ड 10-अंकीय फोन नंबर डालकर सीधे अपने बच्चे के पोर्टल में लॉगिन कर सकते हैं।',
    parentMobileLabel: 'पंजीकृत मोबाइल नंबर या Student ID:',
    parentMobilePlaceholder: '10-अंकीय मोबाइल नंबर दर्ज करें (उदा. 9876543210)',
    parentFetchDataBtn: 'डेटा लोड करें / पोर्टल खोलें',
    parentFetchingData: 'डेटा लोड हो रहा है...',
    parentSecurityNote: 'केवल स्कूल में पंजीकृत अभिभावक ही अपना मोबाइल नंबर दर्ज कर छात्र का डेटा देख सकते हैं।',
    parentChildFound: 'छात्र प्रोफ़ाइल सत्यापित',
    switchChild: 'बच्चा बदलें',

    // Parent 4 Main Cards
    dailyHomeworkCardTitle: 'दैनिक होमवर्क व कार्य',
    dailyHomeworkCardDesc: 'अध्यापकों द्वारा दिया गया आज का गृहकार्य, नोट्स व अध्ययन सामग्री देखें।',
    homeworkCheckerCardTitle: 'होमवर्क चेकर व ट्रैकर',
    homeworkCheckerCardDesc: 'दैनिक कार्य की स्थिति, होमवर्क पूर्ण/अपूर्ण रिकॉर्ड व शिक्षक मूल्यांकन देखें।',
    conductCardTitle: 'दैनिक आचरण व अनुशासन',
    conductCardDesc: 'दैनिक उपस्थिति, स्वच्छता, स्नान, बाल-नाखून व अनुशासन रिपोर्ट देखें।',
    feesCardTitle: 'स्कूल फीस व रसीदें',
    feesCardDesc: 'मासिक फीस विवरण, जमा राशि व आधिकारिक भुगतान रसीदें डाउनलोड करें।',
    vanTrackerCardTitle: 'लाइव वैन जीपीएस ट्रैकिंग',
    vanTrackerCardDesc: 'स्कूल वैन की लाइव लोकेशन, रूट स्टॉप्स व पहुँचने का समय ट्रैक करें।',
    noticeBoardCardTitle: 'स्कूल सूचना पट्ट',
    noticeBoardCardDesc: 'स्कूल की महत्वपूर्ण सूचनाएं, अवकाश आदेश व सर्कुलर तुरंत देखें।',

    // Teacher Login & Portal
    teacherLoginTitle: 'शिक्षक / फैकल्टी लॉगिन',
    teacherLoginDesc: 'शिक्षक अपनी आईडी/मोबाइल और पासवर्ड दर्ज करके शिक्षक पोर्टल में प्रवेश करें।',
    teacherUserIdLabel: 'यूजरनेम, मोबाइल या यूजर आईडी:',
    teacherPasswordLabel: 'गुप्त पासवर्ड:',
    teacherLoginBtn: 'शिक्षक पोर्टल में लॉगिन करें',
    teacherLoggingIn: 'सत्यापित किया जा रहा है...',
    teacherAssignedClass: 'असाइन की गई कक्षाएं',
    staffAttendanceBadge: 'स्टाफ हाजिरी',
    staffPresent: '✓ उपस्थित',
    staffCheckInNeeded: 'चेक-इन',
    schoolQrPoster: 'स्कूल QR पोस्टर',
    qrCheckIn: '📷 स्कूल QR हाजिरी',
    qrCheckOut: '🚪 स्कूल चेक-आउट',
    teacherDataRefreshed: 'डेटा ताज़ा हुआ',

    // Teacher Sub-Navigation Tabs
    tabStaffAttendance: 'स्टाफ हाजिरी (Staff Attendance)',
    tabUploadHomework: 'होमवर्क अपलोड (Upload Homework)',
    tabHomeworkChecker: 'होमवर्क चेकर व ट्रैकर (Check HW)',
    tabRecentSubmissions: 'हाल के असाइनमेंट्स (Recent Submissions)',
    tabDailyConduct: 'दैनिक आचरण व अनुशासन (Daily Conduct)',
    tabSchoolNotices: 'सूचना पट्ट (Notices)',
    tabFindStudent: 'छात्र खोजें / QR स्कैनर',

    // Classroom Conduct & Attendance
    bulkRegisterTab: '📋 पूरी क्लास का हाजिरी व आचरण रजिस्टर',
    historyTab: '📜 दर्ज रिकॉर्ड्स सूची (History)',
    markPresent: 'उपस्थित',
    markAbsent: 'अनुपस्थित',
    bathed: 'स्नान किया',
    uniformClean: 'साफ ड्रेस',
    nailsClean: 'नाखून कटे',
    disciplineGood: 'उत्कृष्ट आचरण',
    disciplineImprove: 'सुधार आवश्यक',
    saveBatchBtn: 'पूरी क्लास का रजिस्टर सुरक्षित करें',
    savingRegister: 'रजिस्टर सेव हो रहा है...',
    todayAttendanceCompleted: 'आज की हाजिरी दर्ज है',

    // Manager Portal
    managerLoginTitle: 'स्कूल एडमिनिस्ट्रेशन लॉगिन',
    managerLoginDesc: 'प्रबंधक अपना यूजरनेम और पासवर्ड दर्ज करके स्कूल एडमिनिस्ट्रेशन पोर्टल में लॉगिन करें।',
    managerPortalTitle: 'स्कूल प्रबंधन पोर्टल (Manager Portal)',
    cardTotalStudents: 'कुल पंजीकृत छात्र',
    cardFeeCollections: 'कुल फीस संकलन',
    cardPendingDues: 'बकाया फीस (Dues)',
    cardTodayAttendance: 'आज की छात्र उपस्थिति',
    managerTabStudents: 'All Students Records',
    managerTabHomework: 'Homework Submissions',
    managerTabBehavior: 'Behavior Logs',
    managerTabFees: 'Fee Collection & Accounts',
    managerTabUsers: 'Faculty & Staff Accounts',
    managerTabVan: 'Live Van GPS Tracker',
    addStudentBtn: 'नया छात्र जोड़ें',
    collectFeeBtn: 'फीस जमा करें',

    // Fees & Receipts
    feeSummaryTitle: 'स्कूल फीस व रसीदें',
    totalSessionFee: 'कुल सत्र फीस',
    totalPaid: 'कुल जमा राशि',
    pendingBalance: 'शुद्ध बकाया राशि',
    advancePaid: 'अग्रिम शुल्क जमा',
    feeStatusDue: 'बकाया (DUE)',
    feeStatusCleared: 'पूर्ण चुकता (NIL)',
    feeStatusAdvance: 'अग्रिम जमा (ADVANCE)',
    receiptNumber: 'रसीद संख्या',
    paymentMode: 'भुगतान माध्यम',
    printReceipt: 'आधिकारिक रसीद प्रिंट करें',

    // Common & Alerts
    present: 'उपस्थित',
    absent: 'अनुपस्थित',
    viewDetails: 'विवरण देखें',
    close: 'बंद करें',
    searchPlaceholder: 'छात्र का नाम, आईडी या रोल नंबर से खोजें...',
    allClasses: 'सभी कक्षाएं',
    class: 'कक्षा',
    date: 'दिनांक',
    status: 'स्थिति',
    actions: 'कार्य',
    yes: 'हाँ',
    no: 'नहीं',
    save: 'सुरक्षित करें',
    cancel: 'रद्द करें',
    loading: 'लोड हो रहा है...'
  }
};
