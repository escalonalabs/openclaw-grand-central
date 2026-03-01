import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetEventStore } from '../store/eventStore';

afterEach(() => {
  cleanup();
  resetEventStore();
});
