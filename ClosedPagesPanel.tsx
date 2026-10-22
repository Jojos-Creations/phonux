import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import InputBase from '@mui/material/InputBase';
import Paper from '@mui/material/Paper';
import SearchIcon from '@mui/icons-material/Search';
import PanelFrame, { panelFrameBareSx } from './PanelFrame.js';
import type { ClosedPageEntry } from './hostApi.js';
import type { ClosedPagesList } from './closedPagesList.js';
import { groupClosedPages } from './closedPagesModel.js';
import { formatClosedPagesDay } from './closedPagesFormat.js';

/**
 * The props of `ClosedPagesPanel`.
 * @public
 */
export interface ClosedPagesPanelProps {
  /** The list to show, from `useClosedPages`. */
  readonly list: ClosedPagesList;
  /** Called with the entry the person chose. The list has already marked it as touched when this runs. */
  readonly onReopen: (entry: ClosedPageEntry) => void;
}

/**
 * The closed pages as a searchable list grouped by the day they closed, newest first. Choosing a row touches its entry
 * in the list and calls `onReopen`. Draws its own frame, so it is used as the body of a panel.
 * @public
 */
export function ClosedPagesPanel({ list, onReopen }: ClosedPagesPanelProps): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const groups = groupClosedPages(list.entries, query);
  const reopen = (entry: ClosedPageEntry): void => {
    list.touch(entry.id);
    onReopen(entry);
  };
  return (
    <PanelFrame data-closed-pages="" sx={{ ...panelFrameBareSx, overflowY: 'auto', p: 1.5 }}>
      <Paper variant="outlined" sx={{ p: '4px 8px', display: 'flex', alignItems: 'center', borderRadius: 3, mb: 1.5, flexShrink: 0 }}>
        <SearchIcon fontSize="small" sx={{ color: 'text.disabled', mr: 0.5 }} />
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search closed pages"
          sx={{ flex: 1, fontSize: 13 }}
          inputProps={{ 'aria-label': 'Search closed pages' }}
        />
      </Paper>
      {!list.loaded ? (
        <Box sx={{ fontSize: 13, color: 'text.disabled', textAlign: 'center', mt: 2 }}>Loading</Box>
      ) : groups.length === 0 ? (
        <Box data-closed-pages-empty="" sx={{ fontSize: 13, color: 'text.disabled', textAlign: 'center', mt: 2 }}>
          {list.entries.length === 0 ? 'No closed pages yet' : 'No matches'}
        </Box>
      ) : (
        groups.map((group) => (
          <Box key={group.date} sx={{ mb: 1.5 }}>
            <Box sx={{ fontSize: 11, fontWeight: 'bold', color: 'text.secondary', mb: 0.5 }}>{formatClosedPagesDay(group.date)}</Box>
            <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {group.entries.map((entry) => (
                <li key={entry.id} data-closed-pages-row="">
                  <ButtonBase
                    onClick={() => reopen(entry)}
                    sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 1, p: 0.75, '&:hover': { bgcolor: 'action.hover' } }}
                  >
                    <Box sx={{ fontSize: 13, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.title === '' ? 'Untitled' : entry.title}
                    </Box>
                    {entry.url !== undefined && entry.url !== '' && (
                      <Box sx={{ fontSize: 12, color: 'text.secondary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {entry.url}
                      </Box>
                    )}
                    <Box sx={{ fontSize: 11, color: 'text.disabled' }}>
                      {new Date(entry.closedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Box>
                  </ButtonBase>
                </li>
              ))}
            </Box>
          </Box>
        ))
      )}
    </PanelFrame>
  );
}
