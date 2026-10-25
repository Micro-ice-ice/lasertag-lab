import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
const base = process.env.BASE_PATH || '';

export default defineConfig({
  plugins: [sveltekit({
    adapter: adapter(),
    paths: { base }
  })]
});
