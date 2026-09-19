// Safe Navigation & External URL Opener Helper
// Ensures popups are not blocked by iframe sandboxes and mobile browser restrictions

export const safeOpenExternalUrl = (url: string) => {
  if (!url) return;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      window.location.href = url;
    }
  }
};
