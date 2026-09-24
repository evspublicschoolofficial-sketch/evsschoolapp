import React, { useState, useEffect } from 'react';
import { Student } from '../types';

/**
 * Converts Google Drive URLs (e.g., https://drive.google.com/file/d/FILE_ID/view...)
 * to direct viewable links: https://lh3.googleusercontent.com/d/FILE_ID
 */
export const formatStudentPhotoUrl = (url: string | null | undefined): string => {
  if (!url) return '';
  const str = String(url).trim();
  if (!str) return '';

  // Match Google Drive file ID from various Drive URL formats
  const driveMatch =
    str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    str.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    str.match(/\/d\/([a-zA-Z0-9_-]+)/);

  if (driveMatch && driveMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
  }
  return str;
};

interface StudentAvatarProps {
  student?: Student | null;
  photoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  imgClassName?: string;
  showUploadBtn?: boolean;
  onUpload?: () => void;
  altText?: string;
}

/**
 * Robust Student Avatar Component:
 * - Dynamic photo fetching from the "Photo" or "Student_Photo" column in Google Sheets
 * - Automatically converts Google Drive URLs to direct viewable links (https://lh3.googleusercontent.com/d/FILE_ID)
 * - Fallback student avatar icon if the photo URL is missing or invalid
 * - referrerPolicy="no-referrer" to bypass Google Drive hotlinking blocks
 */
export const StudentAvatar: React.FC<StudentAvatarProps> = ({
  student,
  photoUrl,
  size = 'md',
  className = '',
  imgClassName = '',
  showUploadBtn = false,
  onUpload,
  altText,
}) => {
  const [imageError, setImageError] = useState(false);

  // Compute effective photo URL checking 'Photo', 'Student_Photo', 'photo' columns
  const rawPhoto =
    photoUrl ||
    (student as any)?.Photo ||
    student?.Student_Photo ||
    (student as any)?.photo ||
    (student as any)?.student_photo ||
    (student as any)?.Photo_URL ||
    '';

  const formattedUrl = formatStudentPhotoUrl(typeof rawPhoto === 'string' ? rawPhoto.trim() : '');

  // Reset error when student or photo changes
  useEffect(() => {
    setImageError(false);
  }, [formattedUrl, student?.Student_ID]);

  // Size configurations
  const sizeMap = {
    xs: {
      box: 'w-6 h-6 rounded-full text-[10px]',
      icon: 'text-[10px]',
      cameraBtn: 'w-4 h-4 text-[8px] -bottom-0.5 -right-0.5',
    },
    sm: {
      box: 'w-8 h-8 rounded-xl text-xs',
      icon: 'text-xs',
      cameraBtn: 'w-5 h-5 text-[9px] -bottom-1 -right-1',
    },
    md: {
      box: 'w-10 h-10 rounded-xl text-sm',
      icon: 'text-sm',
      cameraBtn: 'w-5 h-5 text-[9px] -bottom-1 -right-1',
    },
    lg: {
      box: 'w-16 h-16 rounded-2xl text-xl',
      icon: 'text-xl',
      cameraBtn: 'w-6 h-6 text-[10px] -bottom-1 -right-1',
    },
    xl: {
      box: 'w-24 h-24 rounded-3xl text-3xl',
      icon: 'text-3xl',
      cameraBtn: 'w-8 h-8 text-xs -bottom-1.5 -right-1.5',
    },
  };

  const currentSize = sizeMap[size] || sizeMap.md;
  const studentName = student?.Student_Name || altText || 'Student';
  const initial = studentName.trim().charAt(0).toUpperCase() || 'S';

  const shouldRenderImage = Boolean(formattedUrl) && !imageError;

  return (
    <div className={`relative group shrink-0 inline-block ${className}`}>
      <div
        className={`${currentSize.box} bg-gradient-to-br from-[#0c2340] via-[#10316b] to-[#1e4485] text-amber-300 font-black shadow-md border-2 border-amber-300/80 overflow-hidden flex items-center justify-center select-none`}
      >
        {shouldRenderImage ? (
          <img
            src={formattedUrl}
            alt={studentName}
            className={`w-full h-full object-cover transition-opacity duration-200 ${imgClassName}`}
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
          />
        ) : (
          /* Fallback Student Avatar Icon */
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#0c2340] to-[#153a66] text-amber-300 p-1">
            <i className={`fa-solid fa-user-graduate ${currentSize.icon}`}></i>
            {size === 'lg' || size === 'xl' ? (
              <span className="text-[10px] sm:text-[11px] font-bold text-amber-200/90 tracking-wider uppercase mt-0.5">
                {initial}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Optional Photo Upload/Change Trigger Button */}
      {showUploadBtn && onUpload && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUpload();
          }}
          className={`absolute ${currentSize.cameraBtn} rounded-full bg-[#0c2340] text-amber-300 border-2 border-white flex items-center justify-center shadow-md hover:scale-110 active:scale-95 transition-transform cursor-pointer`}
          title="फ़ोटो बदलें या अपलोड करें (Change or Upload Photo)"
          aria-label="Upload Student Photo"
        >
          <i className="fa-solid fa-camera"></i>
        </button>
      )}
    </div>
  );
};

export default StudentAvatar;
