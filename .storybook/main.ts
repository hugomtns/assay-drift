import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  viteFinal: async (config) => ({
    ...config,
    build: {
      ...config.build,
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        ...config.build?.rolldownOptions,
        output: {
          ...config.build?.rolldownOptions?.output,
          manualChunks: (id) => (id.includes('axe-core') ? 'storybook-a11y' : undefined),
        },
      },
    },
  }),
};

export default config;
