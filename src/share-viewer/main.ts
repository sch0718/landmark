import './styles.css';
import { readLiveHash } from '../domain/trip-live/live-doc';
import { decodeShareHash } from './decode';
import { appUrl } from './encode';
import { readShareDoc } from './parse';
import { applyTheme, renderBroken, renderBrokenLink } from './render';
import { showShareDoc } from './show';
import { startLiveViewer } from './live-view';
const root = document.createElement('div');
root.id = 'root';
document.body.append(root);
applyTheme(document);
const app = appUrl(import.meta.env.VITE_APP_URL);
const block = document.getElementById('tripmap-share')?.textContent?.trim();
if (block) {
  const doc = readShareDoc(document);
  if (doc === null) renderBroken(root);
  else showShareDoc(root, doc, { app });
} else {
  window.onhashchange = () => location.reload();
  const live = readLiveHash(location.hash);
  if (live) void startLiveViewer(root, live);
  else {
    const value = location.hash.startsWith('#d=') ? location.hash.slice(3) : '';
    void decodeShareHash(value).then((doc) => {
      if (doc === null) renderBrokenLink(root);
      else showShareDoc(root, doc, { app, importValue: value });
    });
  }
}
