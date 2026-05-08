import React from 'react';
import * as Lucide from 'lucide-react';

/**
 * Icon — v1 API, Lucide visuals where mapped, FontAwesome fallback otherwise.
 *
 * The original v1 component rendered <i className={`fas fa-${id}`} /> with
 * FontAwesome. That stack works but gives the app a "duotone, glyph-ish"
 * feel that fights the Fluent 2 monoline aesthetic.
 *
 * This rewrite maps the FA ids the app actually uses onto the closest
 * Lucide React icon. Anything not in the map falls back to FA so the UI
 * never breaks on an unmapped id — ESLint warnings will tell us when a
 * new id needs a mapping. Both code paths accept the same `className`.
 *
 * Sizing:
 *   - The FA stylesheet sized icons via font-size on the parent.
 *     Lucide is an SVG sized via width/height. We default to w-4 h-4
 *     unless the consumer's className overrides it. To preserve the
 *     "icon scales with surrounding text" behaviour callers used to
 *     get from FA's `text-xs`/`text-2xl` modifiers, the wrapper uses
 *     `inline-flex items-center` so the SVG centres on the line.
 */

// FA-id → Lucide-component-name. Keep additions alphabetical.
const FA_TO_LUCIDE = {
  // Status & feedback
  'check':                      'Check',
  'check-circle':               'CheckCircle',
  'check-double':               'CheckCheck',
  'circle-check':               'CheckCircle',
  'exclamation-triangle':       'AlertTriangle',
  'exclamation-circle':         'AlertCircle',
  'info-circle':                'Info',
  'times':                      'X',
  'times-circle':               'XCircle',

  // Navigation
  'arrow-up':                   'ArrowUp',
  'arrow-down':                 'ArrowDown',
  'arrow-left':                 'ArrowLeft',
  'arrow-right':                'ArrowRight',
  'chevron-up':                 'ChevronUp',
  'chevron-down':               'ChevronDown',
  'chevron-left':               'ChevronLeft',
  'chevron-right':              'ChevronRight',
  'ellipsis-vertical':          'MoreVertical',
  'ellipsis-horizontal':        'MoreHorizontal',
  'bars':                       'Menu',
  'home':                       'Home',
  'external-link':              'ExternalLink',
  'external-link-alt':          'ExternalLink',
  'undo':                       'RotateCcw',
  'redo':                       'RotateCw',
  'sync-alt':                   'RefreshCw',
  'rotate':                     'RotateCw',

  // Domain
  'file-invoice':               'FileText',
  'file-invoice-dollar':        'FilePlus',
  'file-text':                  'FileText',
  'file-pdf':                   'FileText',
  'file':                       'File',
  'file-contract':              'FileText',
  'list-alt':                   'List',
  'list':                       'List',
  'clipboard-list':             'ClipboardList',
  'clipboard':                  'Clipboard',
  'truck':                      'Truck',
  'industry':                   'Factory',
  'boxes-stacked':              'Boxes',
  'box':                        'Package',
  'boxes':                      'Boxes',
  'tags':                       'Tags',
  'tag':                        'Tag',
  'percent':                    'Percent',
  'sliders':                    'Sliders',
  'cog':                        'Settings',
  'gear':                       'Settings',
  'history':                    'History',
  'signature':                  'PenLine',

  // People
  'user':                       'User',
  'users':                      'Users',
  'user-tag':                   'UserCheck',
  'user-check':                 'UserCheck',
  'user-circle':                'UserCircle',
  'user-shield':                'ShieldCheck',
  'sign-out-alt':               'LogOut',
  'sign-in-alt':                'LogIn',

  // Actions
  'plus':                       'Plus',
  'minus':                      'Minus',
  'edit':                       'Pencil',
  'pen':                        'Pen',
  'pencil':                     'Pencil',
  'trash':                      'Trash2',
  'trash-alt':                  'Trash2',
  'save':                       'Save',
  'download':                   'Download',
  'upload':                     'Upload',
  'eye':                        'Eye',
  'eye-slash':                  'EyeOff',
  'search':                     'Search',
  'filter':                     'Filter',
  'sort':                       'ArrowUpDown',
  'copy':                       'Copy',
  'paste':                      'ClipboardPaste',
  'print':                      'Printer',
  'paper-plane':                'Send',
  'envelope':                   'Mail',

  // Charts
  'chart-line':                 'LineChart',
  'chart-bar':                  'BarChart3',
  'chart-pie':                  'PieChart',
  'chart-area':                 'AreaChart',

  // UI states
  'sun':                        'Sun',
  'moon':                       'Moon',
  'bell':                       'Bell',
  'bookmark':                   'Bookmark',
  'star':                       'Star',
  'heart':                      'Heart',
  'flag':                       'Flag',
  'lock':                       'Lock',
  'unlock':                     'Unlock',
  'key':                        'Key',
  'shield':                     'Shield',
  'circle':                     'Circle',
  'dot-circle':                 'CircleDot',
  'spinner':                    'Loader2',
  'circle-notch':               'Loader2',

  // Money
  'dollar-sign':                'DollarSign',
  'money-bill':                 'Banknote',
  'credit-card':                'CreditCard',
  'wallet':                     'Wallet',

  // Time
  'calendar':                   'Calendar',
  'calendar-day':               'Calendar',
  'clock':                      'Clock',

  // Misc
  'building':                   'Building2',
  'globe':                      'Globe',
  'phone':                      'Phone',
  'map-marker':                 'MapPin',
  'map-pin':                    'MapPin',
  'location-arrow':             'Navigation',
  'link':                       'Link',
  'paperclip':                  'Paperclip',
  'question-circle':            'HelpCircle',
  'lightbulb':                  'Lightbulb',
  'magic':                      'Wand2',
  'thumbs-up':                  'ThumbsUp',
  'thumbs-down':                'ThumbsDown',
  'gavel':                      'Gavel',
  'briefcase':                  'Briefcase'
};

/* Class strings the app sometimes appends to FA `id` (e.g. "fa-spin").
   We strip these and translate them so the SVG keeps the behaviour. */
function splitIdAndModifiers(rawId) {
  const tokens = String(rawId).trim().split(/\s+/);
  const baseId = tokens[0];
  const mods   = tokens.slice(1).join(' ');
  return { baseId, mods };
}

const Icon = ({ id, className = '' }) => {
  const { baseId, mods } = splitIdAndModifiers(id);
  const lucideName = FA_TO_LUCIDE[baseId];
  const LucideCmp  = lucideName ? Lucide[lucideName] : null;

  // Translate FA's `fa-spin` / `fa-pulse` to Tailwind's animation utilities.
  const extraCls = [
    /\bfa-spin\b/.test(mods)  ? 'animate-spin'  : '',
    /\bfa-pulse\b/.test(mods) ? 'animate-pulse' : ''
  ].filter(Boolean).join(' ');

  // No size class in caller? Default to w-4 h-4 so SVG icons read at the
  // same optical size as the Fluent buttons. If caller provides a sizing
  // class via Tailwind text-xl etc, we still drop a default w/h so the
  // SVG has a deterministic geometry.
  const hasSizing = /(?:^|\s)(w-|h-)/.test(className);
  const sizing    = hasSizing ? '' : 'w-4 h-4';

  if (LucideCmp) {
    return (
      <span className={`inline-flex items-center justify-center ${extraCls} ${className}`}>
        <LucideCmp className={sizing} aria-hidden="true" />
      </span>
    );
  }
  // Fallback: keep FontAwesome rendering for unmapped ids so we don't
  // silently lose icons during the v2 migration.
  return <i className={`fas fa-${baseId} ${extraCls} ${className}`} aria-hidden="true" />;
};

export default Icon;
