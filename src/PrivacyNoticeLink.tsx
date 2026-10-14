import "./PrivacyNoticeLink.css";

export function PrivacyNoticeLink() {
  return (
    <a
      className="privacy-notice-link"
      href="https://team.frc4418.org/privacy.html"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Privacy notice (opens in a new tab)"
      title="Privacy notice (opens in a new tab)"
    >
      Privacy notice
    </a>
  );
}
