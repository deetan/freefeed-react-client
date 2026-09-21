import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import cn from 'classnames';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { useEvent } from 'react-use-event-hook';
import { useSelector } from 'react-redux';
import { ButtonLink } from './button-link';
import { Icon } from './fontawesome-icons';
import style from './expandable.module.scss';

// Pixel areas (before the UI scale applied) of the folded text rectangles for
// posts and comments. The Expandable component reduces the height of the text
// to approximately match this area.

const foldedAreas = {
  post: 600 * 130,
  comment: 500 * 110,
  postAnonymous: 860 * 130, // No sidebar, so we need more pixels
  commentAnonymous: 700 * 110,
};

export function Expandable({
  children,
  expanded: givenExpanded = false,
  tail = null,
  panelClass = null,
  contentType = 'post', // or 'comment'
}) {
  const authenticated = useSelector((state) => state.authenticated);
  const uiScale = useSelector((state) => state.uiScale ?? 100) / 100;

  if (contentType !== 'comment' && contentType !== 'post') {
    throw new Error('Unsupported content type');
  }

  const foldedArea = foldedAreas[contentType + (authenticated ? '' : 'Anonymous')];
  const scaledFoldedArea = foldedArea * uiScale * uiScale;
  // Don't fold content that is smaller than this
  const scaledMaxUnfoldedArea = scaledFoldedArea * 1.5;

  const content = useRef(null);
  // Null means content doesn't need to be expandable
  const [maxHeight, setMaxHeight] = useState(null);

  const [expandedByUser, setExpandedByUser] = useState(false);
  const expand = useEvent(() => setExpandedByUser(true));

  const expanded = expandedByUser || givenExpanded;
  const clipped = maxHeight !== null && !expanded;

  // Update the maxHeight when the content dimensions changes
  const update = useEvent(({ width, height }) => {
    if (width * height < scaledMaxUnfoldedArea) {
      setMaxHeight(null);
    } else {
      let targetHeight = scaledFoldedArea / width;
      targetHeight = align(content.current, targetHeight);
      setMaxHeight(`${targetHeight}px`);
    }
  });

  // We use the layout effect just once, to set the initial height without
  // flickering.
  useLayoutEffect(
    () => {
      if (!expanded) {
        update(content.current.getBoundingClientRect());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Update the maxHeight when the content resizes
  useEffect(() => {
    if (!expanded) {
      return observeResizeOf(content.current, ({ contentRect }) => update(contentRect));
    }
  }, [expanded, update]);

  return (
    <>
      <div
        className={clipped ? style.clippedContent : null}
        style={{ maxHeight: expanded ? null : maxHeight }}
      >
        <div ref={content}>{children}</div>
      </div>
      {clipped && (
        <div className={cn('expand-button', panelClass)}>
          <ButtonLink className={style.button} tag="i" onClick={expand} aria-hidden>
            <Icon icon={faChevronDown} className={style.icon} /> Read more
          </ButtonLink>{' '}
          {tail}
        </div>
      )}
    </>
  );
}

/**
 * Align the given offset to the boundary between two closest text lines
 *
 * Text rects can be taller than the line box (it depends on the browser and on
 * the font), so adjacent lines may overlap. The boundary between two lines is
 * the middle of their overlap, or the bottom of the upper line if there is a
 * gap between them (e.g. between paragraphs).
 *
 * @param {Element} rootElement
 * @param {number} targetOffset
 * @returns {number}
 */
function align(rootElement, targetOffset) {
  const { top } = rootElement.getBoundingClientRect();

  // Iterate over all the text nodes and collect the (merged) line rects
  const nodeIterator = document.createNodeIterator(rootElement, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const lines = [];
  let node;
  mainLoop: while ((node = nodeIterator.nextNode())) {
    range.selectNode(node);
    for (const rect of range.getClientRects()) {
      if (rect.height === 0) {
        continue;
      }
      const line = { top: rect.top - top, bottom: rect.bottom - top };
      const last = lines[lines.length - 1];
      if (last && isSameLine(last, line)) {
        last.top = Math.min(last.top, line.top);
        last.bottom = Math.max(last.bottom, line.bottom);
      } else {
        // We need one line below the target to find the last boundary
        if (last && last.top > targetOffset) {
          break mainLoop;
        }
        lines.push(line);
      }
    }
  }

  let result = targetOffset;
  let minDistance = Infinity;
  for (let i = 0; i < lines.length - 1; i++) {
    const boundary = Math.min(lines[i].bottom, (lines[i].bottom + lines[i + 1].top) / 2);
    const distance = Math.abs(boundary - targetOffset);
    if (distance < minDistance) {
      minDistance = distance;
      result = boundary;
    }
  }
  return result;
}

function isSameLine(a, b) {
  const middle = (b.top + b.bottom) / 2;
  return middle > a.top && middle < a.bottom;
}

let resizeObserver = null;
const resizeHandlers = new Map();

/**
 * Subscribe to resize of the given element
 *
 * @param {Element} element
 * @param {(entry: ResizeObserverEntry) => void} callback
 * @returns {() => void} unsubscribe function
 */
function observeResizeOf(element, callback) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        resizeHandlers.get(entry.target)?.(entry);
      }
    });
  }

  resizeHandlers.set(element, callback);
  resizeObserver.observe(element);
  return () => {
    resizeObserver.unobserve(element);
    resizeHandlers.delete(element);
  };
}
