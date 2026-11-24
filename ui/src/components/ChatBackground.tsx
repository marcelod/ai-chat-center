import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChatBackground as Background } from '@shared/background';
import { COLOR_CSS, GRADIENT_CSS } from './backgrounds';

/**
 * The image of an image background as a blob: URL. The hub serves it only with the bearer token, which an
 * <img> or a CSS url() cannot send, so `load` fetches it; a new `file` (a new upload) fetches it again.
 * The URL is revoked when it is replaced or the view goes away.
 */
function useImageUrl(file: string | undefined, load: (() => Promise<Blob>) | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  // The caller passes a new function on every render: only a new file fetches again.
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    const fetchIt = loader.current;
    if (!file || !fetchIt || typeof URL.createObjectURL !== 'function') return;
    let made: string | null = null;
    let live = true;
    fetchIt().then(
      (blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => {
        /* not loaded: the veil alone stays */
      },
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [file]);
  return url;
}

/** The conversation's background behind the message list, under a veil of the page colour for legibility. */
export function ChatBackground({ background, loadImage }: { background: Background; loadImage?: () => Promise<Blob> }) {
  const url = useImageUrl(background.kind === 'image' ? background.file : undefined, loadImage);
  let style: CSSProperties = {};
  let tag: string;
  if (background.kind === 'color') {
    style = { backgroundColor: COLOR_CSS[background.value] };
    tag = `color:${background.value}`;
  } else if (background.kind === 'gradient') {
    style = { backgroundImage: GRADIENT_CSS[background.value] };
    tag = `gradient:${background.value}`;
  } else {
    if (url) style = { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
    tag = 'image';
  }
  return (
    <div aria-hidden="true" data-testid="chat-background" data-background={tag} className="pointer-events-none absolute inset-0" style={style}>
      <div data-testid="chat-background-veil" className="chat-bg-veil absolute inset-0" />
    </div>
  );
}
