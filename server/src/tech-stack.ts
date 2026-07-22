/** package.json 依赖名 → 技术栈标签。命中即加标签（去重）。 */
const DEP_TAGS: Array<[RegExp, string]> = [
  [/^react$/, 'React'],
  [/^react-native$|^expo$/, 'React Native'],
  [/^vue$/, 'Vue'],
  [/^next$/, 'Next.js'],
  [/^nuxt$/, 'Nuxt'],
  [/^@nestjs\/core$/, 'NestJS'],
  [/^fastify$/, 'Fastify'],
  [/^express$/, 'Express'],
  [/^koa$/, 'Koa'],
  [/^@modelcontextprotocol\/sdk$/, 'MCP'],
  [/^electron$/, 'Electron'],
  [/^vite$/, 'Vite'],
  [/^antd$/, 'Ant Design'],
  [/^ant-design-vue$/, 'Ant Design Vue'],
  [/^tailwindcss$/, 'Tailwind'],
  [/^@prisma\/client$|^prisma$/, 'Prisma'],
  [/^typeorm$/, 'TypeORM'],
  [/^typescript$/, 'TypeScript'],
];

/** 标记文件 → 技术栈标签（无 package.json 的项目靠这个）。 */
const FILE_TAGS: Array<[string, string]> = [
  ['go.mod', 'Go'],
  ['Cargo.toml', 'Rust'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Gradle'],
  ['requirements.txt', 'Python'],
  ['pyproject.toml', 'Python'],
  ['Gemfile', 'Ruby'],
  ['composer.json', 'PHP'],
  ['pubspec.yaml', 'Flutter'],
  ['deno.json', 'Deno'],
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * 推断技术栈标签。
 * @param fileNames 项目根（含嵌套 git 子目录）目录项名集合
 * @param pkg       已解析的 package.json（可为空）
 */
export function detectTechStack(fileNames: Set<string>, pkg: PackageJson | null): string[] {
  const tags = new Set<string>();

  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const dep of Object.keys(deps)) {
      for (const [re, tag] of DEP_TAGS) if (re.test(dep)) tags.add(tag);
    }
  }
  for (const [file, tag] of FILE_TAGS) if (fileNames.has(file)) tags.add(tag);

  // 苹果原生工程：目录里有 *.xcodeproj / *.xcworkspace
  if ([...fileNames].some((n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace'))) {
    tags.add('Swift/iOS');
  }
  // 微信小程序：典型 project.config.json + app.json
  if (fileNames.has('project.config.json') && fileNames.has('app.json')) {
    tags.add('微信小程序');
  }

  return [...tags];
}
