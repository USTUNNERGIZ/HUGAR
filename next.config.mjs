/** HUGAR GitHub Pages: static output; no Node server. */
const isPages = process.env.HUGAR_GITHUB_PAGES === '1';
const config = {
  output: 'export',
  trailingSlash: true,
  ...(isPages ? { basePath: '/HUGAR', assetPrefix: '/HUGAR/' } : {}),
};
export default config;
