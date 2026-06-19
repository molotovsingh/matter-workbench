import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api/client';
import { COMMAND_PANEL_NATIVE_SUGGESTIONS } from '../lib/nativeCommands';
import { getErrorMessage } from '../lib/errors';
import type { ConfigurableSkill } from '../types';

export interface CommandSuggestion {
  label: string;
  description: string;
  command: string;
  customSkill?: boolean;
}

const CUSTOM_SKILL_MODIFICATION_RE = /\b(improve|change|update|modify|revise|refine|adjust|tweak|rewrite|rework)\b/i;

export function looksLikeCustomSkillModification(input: string, suggestions: CommandSuggestion[]): boolean {
  if (!CUSTOM_SKILL_MODIFICATION_RE.test(input)) return false;
  const lowerInput = input.toLowerCase();
  return suggestions.some((suggestion) => {
    if (!suggestion.customSkill) return false;
    const slash = suggestion.command.toLowerCase();
    const label = suggestion.label.toLowerCase();
    return Boolean(slash && lowerInput.includes(slash))
      || Boolean(label && lowerInput.includes(label));
  });
}

export const STATIC_COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  { label: 'New skill', description: 'Design a reusable matter skill', command: 'new skill' },
  { label: 'Find a matter', description: 'Open matter picker', command: 'find a matter' },
  ...COMMAND_PANEL_NATIVE_SUGGESTIONS,
];

interface UseCommandSuggestionsOptions {
  appendTerminal: (lines: string[]) => void;
}

export function useCommandSuggestions({ appendTerminal }: UseCommandSuggestionsOptions) {
  const [baseSuggestions, setBaseSuggestions] = useState<CommandSuggestion[]>(STATIC_COMMAND_SUGGESTIONS);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const suggestionsLoadSeqRef = useRef(0);

  const loadCommandSuggestions = useCallback(async () => {
    const seq = suggestionsLoadSeqRef.current + 1;
    suggestionsLoadSeqRef.current = seq;
    try {
      const result = await api.getConfigurableSkills();
      if (suggestionsLoadSeqRef.current !== seq) return;
      const customSuggestions = (result.skills || [])
        .filter((skill: ConfigurableSkill) => {
          if (skill.status !== 'active') return false;
          return Boolean(skill.slash);
        })
        .map((skill) => ({
          label: skill.title || skill.slash,
          description: skill.description || 'Run this custom skill',
          command: skill.slash,
          customSkill: true,
        }));
      setBaseSuggestions([...STATIC_COMMAND_SUGGESTIONS, ...customSuggestions]);
    } catch (error) {
      if (suggestionsLoadSeqRef.current !== seq) return;
      appendTerminal([`[skills] command suggestions unavailable: ${getErrorMessage(error)}`]);
      setBaseSuggestions(STATIC_COMMAND_SUGGESTIONS);
    }
  }, [appendTerminal]);

  useEffect(() => {
    void loadCommandSuggestions();
  }, [loadCommandSuggestions]);

  const resetSuggestions = useCallback(() => {
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setActiveSuggestion(-1);

    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const q = value.toLowerCase();
    const matched = baseSuggestions.filter(
      (s) => s.label.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
    );
    setSuggestions(matched.slice(0, 12));
    setShowSuggestions(matched.length > 0);
  }, [baseSuggestions]);

  const pickSuggestion = useCallback(() => {
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  }, []);

  const handleKeyDown = useCallback((
    e: KeyboardEvent<HTMLInputElement>,
    onPickSuggestion: (command: string) => void,
  ) => {
    if (!showSuggestions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      onPickSuggestion(suggestions[activeSuggestion].command);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }, [activeSuggestion, showSuggestions, suggestions]);

  return {
    activeSuggestion,
    baseSuggestions,
    handleInputChange,
    handleKeyDown,
    loadCommandSuggestions,
    pickSuggestion,
    resetSuggestions,
    showSuggestions,
    suggestions,
  };
}
