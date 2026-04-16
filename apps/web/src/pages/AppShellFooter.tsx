import styles from "./MyDashboard.module.css";

type Props = {
  onOpenAssistant: () => void;
};

export function AppShellFooter({ onOpenAssistant }: Props) {
  return (
    <footer className={styles.shellFooter}>
      <div className={styles.shellFooterInner}>
        <span className={styles.shellFooterProduct}>Capability Studio</span>
        <span className={styles.shellFooterSep} aria-hidden>
          ·
        </span>
        <a
          className={styles.shellFooterLink}
          href="https://feijoa8.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Feijoa8
        </a>
        <span className={styles.shellFooterSep} aria-hidden>
          ·
        </span>
        <button
          type="button"
          className={styles.shellFooterButton}
          onClick={onOpenAssistant}
        >
          Help
        </button>
        <span className={styles.shellFooterSep} aria-hidden>
          ·
        </span>
        <a className={styles.shellFooterLink} href="#privacy">
          Privacy
        </a>
        <span className={styles.shellFooterSep} aria-hidden>
          ·
        </span>
        <a className={styles.shellFooterLink} href="#terms">
          Terms
        </a>
      </div>
    </footer>
  );
}
