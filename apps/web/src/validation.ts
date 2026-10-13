import { z } from 'zod';

// Configure before feature imports construct schemas; the production CSP forbids eval.
z.config({ jitless: true });
