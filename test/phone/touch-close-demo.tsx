import { createRoot } from 'react-dom/client';
import { DragToClose } from '../../index';

// A tall page with one drag-to-close handle at its top, so a vertical touch can scroll the page or drag the handle.
function App() {
  const onClose = () => {
    (window as unknown as { closes: number }).closes += 1;
  };
  return (
    <div style={{ height: 3000, paddingTop: 16 }}>
      <DragToClose onClose={onClose}>
        {(handle) => (
          <div data-grab="" onPointerDown={handle.onPointerDown} style={{ height: 60, background: '#ccc' }}>
            grab
          </div>
        )}
      </DragToClose>
    </div>
  );
}

(window as unknown as { closes: number }).closes = 0;
createRoot(document.getElementById('root')!).render(<App />);
