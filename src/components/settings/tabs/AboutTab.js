// No need to import React with modern JSX transform
import { useTranslation } from 'react-i18next';

const AboutTab = ({ backgroundType }) => {
  const { t } = useTranslation();

  // Determine the background class based on the backgroundType
  const getBackgroundClass = () => {
    if (!backgroundType || backgroundType === 'default') {
      return '';
    }

    if (backgroundType === 'random') {
      return '';  // This should never happen as random is resolved in the parent component
    }

    return `alternative-bg${backgroundType === 'alternative' ? '' : `-${backgroundType}`}`;
  };

  // Function to replay the onboarding animation
  const handleReplayOnboarding = () => {
    // Remove the flag from localStorage so the onboarding will show again
    localStorage.removeItem('has_visited_site');

    // Reload the page to show the onboarding
    window.location.reload();
  };

  return (
    <div className={`settings-section about-section ${getBackgroundClass()}`}>
      <h3>{t('settings.about', 'About')}</h3>
      <div className="about-content">
        <h2 className="about-app-title">One-sub-tool</h2>
        <div className="creator-info">
          <p><strong>{t('settings.creator', 'Creator')}:</strong> nganlinh4</p>
          <p>
            <strong>GitHub:</strong>
            <a href="https://github.com/nganlinh4" target="_blank" rel="noopener noreferrer">
              https://github.com/nganlinh4
            </a>
          </p>
          <p>
            <strong>YouTube:</strong>
            <a href="https://www.youtube.com/@tteokl" target="_blank" rel="noopener noreferrer">
              https://www.youtube.com/@tteokl
            </a>
          </p>
          <p>
            <strong>Google Scholar:</strong>
            <a href="https://scholar.google.com/citations?user=kWFVuFwAAAAJ&hl=en" target="_blank" rel="noopener noreferrer">
              https://scholar.google.com/citations?user=kWFVuFwAAAAJ&hl=en
            </a>
          </p>
          <p>
            <strong>Email:</strong>
            <a href="mailto:nganlinh4@gmail.com">
              nganlinh4@gmail.com
            </a>
          </p>
        </div>
        <div className="app-description">
          <p>{t('settings.appDescription', 'One-sub-tool helps you create, edit, translate, and narrate subtitles for your videos.')}</p>
        </div>

        {/* Replay Onboarding Button */}
        <div className="replay-onboarding-container">
          <button
            className="replay-onboarding-button"
            onClick={handleReplayOnboarding}
            title={t('settings.replayOnboardingTooltip', 'Show the welcome animation again')}
            aria-label={t('settings.replayOnboardingTooltip', 'Show the welcome animation again')}
          >
            {t('settings.replayOnboarding', 'Replay Welcome Animation')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AboutTab;

