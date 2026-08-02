import { useAppStore } from './state/store';
import { AppShell } from './ui/AppShell';

export default function App() {
  const step = useAppStore((s) => s.step);

  return (
    <AppShell step={step}>
      <p className="text-sm text-slate-500">Step content lands in later tasks.</p>
    </AppShell>
  );
}
