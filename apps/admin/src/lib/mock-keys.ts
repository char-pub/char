/**
 * mock 构建中保存扮演角色的 localStorage 键。单独放在这里，让 Playwright 测试可以直接引用
 * （这个文件不依赖 Vite 的构建环境）。
 */

/** 扮演的员工角色，逗号分隔。 */
export const MOCK_ROLES_KEY = "charpub.admin.mock-roles";

/** mock 后端实际按这些角色判断权限，用来模拟页面打开之后角色被收回。 */
export const MOCK_ENFORCE_ROLES_KEY = "charpub.admin.mock-enforce-roles";
