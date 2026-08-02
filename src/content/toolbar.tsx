import { useState, useEffect, useRef } from 'react';
import type { ArrowHeadStyle, ToolId } from '../shared/types';
import { TOOL_LABELS } from '../shared/types';
import { TOOL_ICONS } from './icons';

const MAIN_TOOLS: ToolId[] = ['pencil', 'highlighter', 'arrow', 'rectangle', 'ellipse', 'text'];
const EXTRA_TOOLS: ToolId[] = ['laser', 'spotlight', 'eraser'];

const CORE_COLORS = ['#A78BFA', '#86EFAC', '#F5E8A6', '#0A0A0C', '#FFFFFF'];
const EXTRA_COLORS = ['#7C5CE6', '#4ADE80', '#E7CF6E', '#8B8B93', '#26262B'];

const TIMER_PRESETS = [5, 10, 15]; // minutes

export interface ToolbarProps {
  onToolChange: (tool: ToolId) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onHeadStyleChange: (style: ArrowHeadStyle) => void;
  onFilledChange: (filled: boolean) => void;
  onClear: () => void;
  onSavePng: () => void;
  onDrawModeToggle: (enabled: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  drawModeEnabled: boolean;
  currentTool: ToolId;
  currentColor: string;
  currentWidth: number;
  currentHeadStyle: ArrowHeadStyle;
  currentFilled: boolean;
  statusText?: string;
}

export function Toolbar({
  onToolChange,
  onColorChange,
  onWidthChange,
  onHeadStyleChange,
  onFilledChange,
  onClear,
  onSavePng,
  onDrawModeToggle,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  drawModeEnabled,
  currentTool,
  currentColor,
  currentWidth,
  currentHeadStyle,
  currentFilled,
  statusText = '',
}: ToolbarProps) {
  const [expanded, setExpanded] = useState(true);
  const [moreColors, setMoreColors] = useState(false);
  const [timerOn, setTimerOn] = useState(false);
  const [maskOn, setMaskOn] = useState(false);
  const [maskMode, setMaskMode] = useState(0); // 0 = screen, 1 = blackout, 2 = whiteout
  const [seconds, setSeconds] = useState(754);

  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (timerOn) {
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => (s > 0 ? s - 1 : 0));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [timerOn]);

  const formatTime = (secs: number) => {
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const startTimer = (minutes: number) => {
    setSeconds(minutes * 60);
    setTimerOn(true);
  };

  const dropTimer = () => {
    setTimerOn(false);
  };

  const addMask = () => {
    setMaskOn(true);
    setMaskMode(0);
  };

  const cycleMask = () => {
    setMaskMode((m) => (m + 1) % 3);
  };

  const togglePanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((ex) => !ex);
  };

  const expandPanel = () => {
    if (!expanded) {
      setExpanded(true);
    }
  };

  const collapsePanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(false);
  };

  const maskLabels = ['Screen', 'Blackout', 'Whiteout'];
  const maskColors = ['#0A0A0C', '#0A0A0C', '#FFFFFF'];
  const maskOpacities = [0, 0.94, 0.94];
  const maskSwatches = ['transparent', '#0A0A0C', '#FFFFFF'];

  const warn = seconds < 120;
  const needsSetup = !timerOn || !maskOn;

  const UNDO_ICON = 'M9 7L5 11l4 4M5 11h8a5 5 0 010 10h-3';
  const REDO_ICON = 'M15 7l4 4-4 4M19 11h-8a5 5 0 000 10h3';

  return (
    <>
      {/* Timer chip (bottom-left) */}
      {timerOn && (
        <div
          style={{
            position: 'fixed',
            left: '56px',
            bottom: '44px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            height: '34px',
            padding: '0 6px 0 12px',
            borderRadius: '999px',
            background: 'rgba(28,28,32,0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            zIndex: 2147483646,
          }}
        >
          <i
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '999px',
              animation: 'pulseDot 1.6s ease-in-out infinite',
              background: warn ? '#F5E8A6' : '#86EFAC',
            }}
          />
          <span
            style={{
              font: '500 13px/1 Manrope,system-ui,sans-serif',
              fontVariantNumeric: 'tabular-nums',
              color: warn ? '#F5E8A6' : '#F5F5F7',
            }}
          >
            {formatTime(seconds)}
          </span>
          <span style={{ font: '400 11px/1 Manrope,system-ui,sans-serif', color: '#8B8B93' }}>left</span>
          <button
            onClick={dropTimer}
            title="Remove timer"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '999px',
              background: 'transparent',
              border: 'none',
              color: '#8B8B93',
              font: '400 14px/1 Manrope,system-ui,sans-serif',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#26262B';
              e.currentTarget.style.color = '#F5F5F7';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#8B8B93';
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Mask chip (bottom-left, next to timer) */}
      {maskOn && (
        <div
          style={{
            position: 'fixed',
            left: timerOn ? '220px' : '56px',
            bottom: '44px',
            zIndex: 2147483646,
          }}
        >
          <button
            onClick={cycleMask}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              height: '34px',
              padding: '0 14px',
              borderRadius: '999px',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              cursor: 'pointer',
              background: maskMode === 0 ? 'rgba(28,28,32,0.72)' : 'rgba(28,28,32,0.88)',
              border: maskMode === 0 ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(167,139,250,0.55)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = 'brightness(1.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'none';
            }}
          >
            <i
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '4px',
                border: '1px solid rgba(255,255,255,0.28)',
                background: maskSwatches[maskMode],
              }}
            />
            <span
              style={{
                font: '500 13px/1 Manrope,system-ui,sans-serif',
                color: maskMode === 0 ? '#F5F5F7' : '#A78BFA',
              }}
            >
              {maskLabels[maskMode]}
            </span>
          </button>
        </div>
      )}

      {/* Main toolbar panel */}
      <div
        onClick={expandPanel}
        style={{
          position: 'fixed',
          right: '56px',
          top: '48px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          background: 'rgba(28,28,32,0.78)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          transition: 'width 180ms cubic-bezier(0.2,0.8,0.2,1), height 180ms cubic-bezier(0.2,0.8,0.2,1), border-radius 180ms cubic-bezier(0.2,0.8,0.2,1), padding 180ms cubic-bezier(0.2,0.8,0.2,1)',
          cursor: expanded ? 'default' : 'pointer',
          width: expanded ? '216px' : '56px',
          height: expanded ? 'auto' : '56px',
          borderRadius: expanded ? '28px' : '999px',
          padding: expanded ? '14px' : '13px',
          zIndex: 2147483647,
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '28px' }}>
          <button
            onClick={togglePanel}
            style={{
              flex: 'none',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 19l3-.8L19.2 7A2 2 0 0016.4 4.2L5.2 15.4 4.4 19 5 19z"
                stroke="#A78BFA"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M14.6 6l3.4 3.4" stroke="#F5E8A6" strokeWidth="1.6" />
            </svg>
          </button>
          {expanded && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                flex: 1,
                animation: 'rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both',
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  font: '500 13px/1 Manrope,system-ui,sans-serif',
                  color: '#F5F5F7',
                }}
              >
                {TOOL_LABELS[currentTool]}
              </span>
              <button
                onClick={() => onUndo?.()}
                title="Undo"
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '12px',
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: canUndo ? 'pointer' : 'default',
                }}
                onMouseEnter={(e) => canUndo && (e.currentTarget.style.background = '#26262B')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path
                    d={UNDO_ICON}
                    stroke={canUndo ? '#F5F5F7' : 'rgba(139,139,147,0.45)'}
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                onClick={() => onRedo?.()}
                title="Redo"
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '12px',
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: canRedo ? 'pointer' : 'default',
                }}
                onMouseEnter={(e) => canRedo && (e.currentTarget.style.background = '#26262B')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path
                    d={REDO_ICON}
                    stroke={canRedo ? '#F5F5F7' : 'rgba(139,139,147,0.45)'}
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                onClick={collapsePanel}
                title="Collapse"
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#8B8B93',
                  font: '400 15px/1 Manrope,system-ui,sans-serif',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#26262B';
                  e.currentTarget.style.color = '#F5F5F7';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#8B8B93';
                }}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {expanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
            {/* Main tools (6-col grid) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6,1fr)',
                gap: '4px',
                animation: 'rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both',
                animationDelay: '50ms',
              }}
            >
              {MAIN_TOOLS.map((tool) => (
                <button
                  key={tool}
                  onClick={() => onToolChange(tool)}
                  title={TOOL_LABELS[tool]}
                  style={{
                    height: '30px',
                    borderRadius: '12px',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    background: currentTool === tool ? 'rgba(167,139,250,0.18)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (currentTool !== tool) e.currentTarget.style.background = '#26262B';
                  }}
                  onMouseLeave={(e) => {
                    if (currentTool !== tool) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d={TOOL_ICONS[tool]}
                      stroke={currentTool === tool ? '#A78BFA' : '#8B8B93'}
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>

            {/* Extra tools (3-col grid) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3,1fr)',
                gap: '4px',
                animation: 'rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both',
                animationDelay: '100ms',
              }}
            >
              {EXTRA_TOOLS.map((tool) => (
                <button
                  key={tool}
                  onClick={() => onToolChange(tool)}
                  title={TOOL_LABELS[tool]}
                  style={{
                    height: '30px',
                    borderRadius: '12px',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    background: currentTool === tool ? 'rgba(167,139,250,0.18)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (currentTool !== tool) e.currentTarget.style.background = '#26262B';
                  }}
                  onMouseLeave={(e) => {
                    if (currentTool !== tool) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d={TOOL_ICONS[tool]}
                      stroke={currentTool === tool ? '#A78BFA' : '#8B8B93'}
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>

            {/* Color swatches */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                animation: 'rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both',
                animationDelay: '150ms',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '2px 4px' }}>
                {CORE_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => onColorChange(color)}
                    style={{
                      width: '18px',
                      height: '18px',
                      padding: 0,
                      borderRadius: '999px',
                      cursor: 'pointer',
                      background: color,
                      border:
                        color === '#0A0A0C' || color === '#26262B'
                          ? '1px solid rgba(255,255,255,0.18)'
                          : 'none',
                      boxShadow:
                        currentColor === color ? '0 0 0 2px #1C1C20, 0 0 0 4px #F5F5F7' : 'none',
                    }}
                  />
                ))}
                <button
                  onClick={() => setMoreColors(!moreColors)}
                  style={{
                    marginLeft: 'auto',
                    height: '20px',
                    padding: '0 8px',
                    borderRadius: '999px',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#8B8B93',
                    font: '500 11px/1 Manrope,system-ui,sans-serif',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#26262B';
                    e.currentTarget.style.color = '#F5F5F7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#8B8B93';
                  }}
                >
                  {moreColors ? 'Fewer' : 'More'}
                </button>
              </div>
              {moreColors && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '2px 4px',
                    animation: 'rowIn 140ms cubic-bezier(0.2,0.8,0.2,1) both',
                  }}
                >
                  {EXTRA_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => onColorChange(color)}
                      style={{
                        width: '18px',
                        height: '18px',
                        padding: 0,
                        borderRadius: '999px',
                        cursor: 'pointer',
                        background: color,
                        border:
                          color === '#0A0A0C' || color === '#26262B'
                            ? '1px solid rgba(255,255,255,0.18)'
                            : 'none',
                        boxShadow:
                          currentColor === color ? '0 0 0 2px #1C1C20, 0 0 0 4px #F5F5F7' : 'none',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Size slider */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                padding: '0 4px',
                animation: 'rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both',
                animationDelay: '200ms',
              }}
            >
              <input
                type="range"
                min="1"
                max="8"
                value={currentWidth}
                onChange={(e) => onWidthChange(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#A78BFA', height: '4px' }}
              />
              <span
                style={{
                  font: '500 11px/1 Manrope,system-ui,sans-serif',
                  color: '#8B8B93',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: '14px',
                  textAlign: 'right',
                }}
              >
                {currentWidth}
              </span>
            </div>

            {/* Session add-ons */}
            {needsSetup && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '7px',
                  paddingTop: '11px',
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  animation: 'rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both',
                  animationDelay: '250ms',
                }}
              >
                <span
                  style={{
                    font: '500 11px/1 Manrope,system-ui,sans-serif',
                    color: '#8B8B93',
                    paddingLeft: '4px',
                  }}
                >
                  Session add-ons
                </span>
                {!timerOn && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        font: '400 12px/1 Manrope,system-ui,sans-serif',
                        color: '#F5F5F7',
                        paddingLeft: '4px',
                      }}
                    >
                      Countdown
                    </span>
                    {TIMER_PRESETS.map((mins) => (
                      <button
                        key={mins}
                        onClick={() => startTimer(mins)}
                        style={{
                          flex: 'none',
                          height: '24px',
                          padding: '0 7px',
                          borderRadius: '999px',
                          background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#F5F5F7',
                          font: '500 11px/1 Manrope,system-ui,sans-serif',
                          fontVariantNumeric: 'tabular-nums',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#26262B')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                )}
                {!maskOn && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        flex: 1,
                        font: '400 12px/1 Manrope,system-ui,sans-serif',
                        color: '#F5F5F7',
                        paddingLeft: '4px',
                      }}
                    >
                      Screen mask
                    </span>
                    <button
                      onClick={addMask}
                      style={{
                        height: '24px',
                        padding: '0 11px',
                        borderRadius: '999px',
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#F5F5F7',
                        font: '500 11px/1 Manrope,system-ui,sans-serif',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#26262B')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div
              style={{
                display: 'flex',
                gap: '6px',
                animation: 'rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both',
                animationDelay: '300ms',
              }}
            >
              <button
                onClick={onClear}
                style={{
                  flex: 1,
                  height: '32px',
                  borderRadius: '999px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#F5F5F7',
                  font: '500 13px Manrope,system-ui,sans-serif',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#26262B')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Clear
              </button>
              <button
                onClick={onSavePng}
                style={{
                  flex: 1,
                  height: '32px',
                  borderRadius: '999px',
                  background: '#86EFAC',
                  border: 'none',
                  color: '#0A2E1B',
                  font: '500 13px Manrope,system-ui,sans-serif',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#9df3bd')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#86EFAC')}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mask overlay */}
      {maskOn && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            transition: 'opacity 180ms cubic-bezier(0.2,0.8,0.2,1)',
            background: maskColors[maskMode],
            opacity: maskOpacities[maskMode],
            zIndex: 2147483645,
          }}
        />
      )}

      <style>{`
        @keyframes rowIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes pulseDot {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
      `}</style>
    </>
  );
}

export function setToolbarStatus(text: string) {
  // This will be handled via props instead
  console.log('Status:', text);
}
