import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus } from 'lucide-react';
import clsx from 'clsx';

/**
 * FilterChips — applied filter row above a list table.
 *
 * <FilterChips
 *   chips={[{ id:1, label:'Status: Pending', onRemove }, ...]}
 *   onAdd={() => openFilterPicker()}
 * />
 *
 * Chips animate in/out via AnimatePresence (height + opacity).
 */
export default function FilterChips({ chips = [], onAdd, className = '' }) {
  if (!chips.length && !onAdd) return null;

  return (
    <div className={clsx('flex flex-wrap items-center gap-2 mb-3', className)}>
      <AnimatePresence initial={false}>
        {chips.map((chip) => (
          <motion.span
            key={chip.id ?? chip.label}
            layout
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{    opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.16 }}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1 h-6 rounded-pill bg-accent-soft text-accent-text text-[12px] font-medium"
          >
            <span>{chip.label}</span>
            {chip.onRemove && (
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.label}`}
                className="w-4 h-4 grid place-items-center rounded-full hover:bg-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </motion.span>
        ))}
      </AnimatePresence>

      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 px-2 h-6 rounded-pill text-[12px] text-n-600 hover:bg-n-100 hover:text-n-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="w-3 h-3" />
          Add filter
        </button>
      )}
    </div>
  );
}
