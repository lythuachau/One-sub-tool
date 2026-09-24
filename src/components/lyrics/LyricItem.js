import React, { useState, useRef, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../utils/timeFormatter';

// Continuous progress indicator component
const ContinuousProgressIndicator = ({ lyric, isCurrentLyric, currentTime }) => {
  const progressRef = useRef(null);
  const animationRef = useRef(null);
  const videoRef = useRef(document.querySelector('video')); // Reference to the video element

  // Function to update the progress indicator
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const updateProgress = () => {
    if (!progressRef.current || !isCurrentLyric) return;

    // Get the current time from the video element if available, otherwise use the prop
    const video = videoRef.current;
    const time = video && !video.paused ? video.currentTime : currentTime;

    // Calculate the progress percentage
    const progress = Math.min(1, Math.max(0, (time - lyric.start) / (lyric.end - lyric.start)));

    // Update the transform
    progressRef.current.style.transform = `scaleX(${progress})`;

    // Continue the animation if this is the current lyric
    if (isCurrentLyric) {
      animationRef.current = requestAnimationFrame(updateProgress);
    }
  };

  // Set up the animation when the component mounts or when isCurrentLyric changes
  useEffect(() => {
    // If this is the current lyric, start the animation
    if (isCurrentLyric) {
      // Make sure we have the latest video reference
      videoRef.current = document.querySelector('video');

      // Start the animation
      animationRef.current = requestAnimationFrame(updateProgress);
    }

    // Clean up the animation when the component unmounts or when isCurrentLyric changes
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isCurrentLyric, lyric, updateProgress]); // Include the entire lyric object to handle any changes

  // Update when currentTime changes (for seeking)
  useEffect(() => {
    if (isCurrentLyric) {
      updateProgress();
    }
  }, [currentTime, isCurrentLyric, updateProgress]); // Include isCurrentLyric in the dependency array

  // Only render if this is the current lyric
  if (!isCurrentLyric) return null;

  return (
    <div
      ref={progressRef}
      className="progress-indicator"
      style={{
        width: '100%',
        transform: `scaleX(${Math.min(1, Math.max(0, (currentTime - lyric.start) / (lyric.end - lyric.start)))})` // Initial value
      }}
    />
  );
};

const LyricItem = ({
  lyric,
  index,
  isCurrentLyric,
  currentTime,
  allowEditing,
  isDragging,
  onLyricClick,
  onMouseDown,
  getLastDragEnd,
  onTextEdit,
  onSplitLyric,
  onMerge,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(lyric.text);
  const textInputRef = useRef(null);
  const splitAppliedRef = useRef(false);

  const handleTextSubmit = () => {
    if (splitAppliedRef.current) {
      splitAppliedRef.current = false;
      setIsEditing(false);
      return;
    }
    if (editText.trim() !== lyric.text) {
      onTextEdit(index, editText.trim());
    }
    setIsEditing(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Backspace' && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0 && index > 0) {
      e.preventDefault();
      onMerge(index - 1);
      setIsEditing(false);
      return;
    }

    if (e.key === 'Enter') {
      if (e.shiftKey) return;

      e.preventDefault();
      const splitApplied = onSplitLyric?.(index, e.currentTarget.selectionStart, editText);
      if (!splitApplied) {
        handleTextSubmit();
      } else {
        splitAppliedRef.current = true;
        setIsEditing(false);
      }
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditText(lyric.text);
    }
  };

  const handleTextClick = (e) => {
    e.stopPropagation();
    if (allowEditing) {
      splitAppliedRef.current = false;
      setIsEditing(true);
      setEditText(lyric.text);
      setTimeout(() => {
        textInputRef.current?.focus();
        const endPosition = String(lyric.text ?? '').length;
        textInputRef.current?.setSelectionRange(endPosition, endPosition);
      }, 0);
      return;
    }
    onLyricClick(lyric.start);
  };

  return (
    <div className="lyric-item-container">
      <div
        data-lyric-index={index}
        className={`lyric-item ${isCurrentLyric ? 'current' : ''}`}
        onClick={() => {
          if (Date.now() - getLastDragEnd() < 100) {
            return;
          }
          onLyricClick(lyric.start);
        }}
      >
        <div className="lyric-content">
          <div className="lyric-text">
            {isEditing ? (
              <textarea
                ref={textInputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleTextSubmit}
                onKeyDown={handleKeyPress}
                className="lyric-text-input"
                rows={Math.max(2, editText.split('\n').length)}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span
                className={allowEditing ? 'lyric-text-clickable' : ''}
                onClick={handleTextClick}
                title={allowEditing ? t('lyrics.clickToEdit', 'Click to edit. Press Enter to split at the cursor.') : undefined}
              >
                {lyric.text.split('\n').map((line, lineIndex) => (
                  <React.Fragment key={lineIndex}>
                    {lineIndex > 0 && <br />}
                    {line}
                  </React.Fragment>
                ))}
              </span>
            )}
          </div>

          {/* Timing controls slightly to the left */}
          {allowEditing && (
            <div className="timing-controls">
              <span
                className={`time-control start-time ${isDragging(index, 'start') ? 'dragging' : ''}`}
                onMouseDown={(e) => onMouseDown(e, index, 'start')}
              >
                {formatTime(lyric.start, 'hms_ms')}
              </span>

              <span className="time-separator">-</span>

              <span
                className={`time-control end-time ${isDragging(index, 'end') ? 'dragging' : ''}`}
                onMouseDown={(e) => onMouseDown(e, index, 'end')}
              >
                {formatTime(lyric.end, 'hms_ms')}
              </span>
            </div>
          )}
        </div>

        <ContinuousProgressIndicator
          lyric={lyric}
          isCurrentLyric={isCurrentLyric}
          currentTime={currentTime}
        />
      </div>
    </div>
  );
};

// Use memo to prevent unnecessary re-renders
const MemoizedLyricItem = memo(LyricItem, (prevProps, nextProps) => {
  // Only re-render if these props change
  if (prevProps.isCurrentLyric !== nextProps.isCurrentLyric) return false;
  if (prevProps.isCurrentLyric && prevProps.currentTime !== nextProps.currentTime) return false;
  if (prevProps.lyric !== nextProps.lyric) return false;
  if (prevProps.isDragging !== nextProps.isDragging) return false;
  if (prevProps.isEditing !== nextProps.isEditing) return false;

  // Don't re-render for other prop changes
  return true;
});

export default MemoizedLyricItem;
