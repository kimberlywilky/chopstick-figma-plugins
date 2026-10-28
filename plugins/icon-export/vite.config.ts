import { defineConfig } from 'vite'
import { resolve } from 'path'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => {
  if (mode === 'ui') {
    return {
      plugins: [viteSingleFile()],
      build: {
        target: 'es2017',
        outDir: 'dist',
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(__dirname, 'src/ui.html'),
          output: {
            entryFileNames: '[name].js'
          }
        }
      }
    }
  }

  return {
    build: {
      target: 'es2017',
      outDir: 'dist',
      emptyOutDir: true,
      lib: {
        entry: resolve(__dirname, 'src/main.ts'),
        name: 'main',
        fileName: () => 'main.js',
        formats: ['iife']
      }
    }
  }
})
