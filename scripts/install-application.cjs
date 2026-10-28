'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Windows may keep a directory handle open after the application exits.
// Move its contents in that case, recording every move so a failure rolls back.
function installApplication({resources, staging, installed, backup, io = fs}) {
  const root = path.resolve(resources);
  function checked(target) {
    const absolute = path.resolve(target);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('应用更新路径超出发布目录');
    }
    return absolute;
  }
  [staging, installed, backup].forEach(checked);
  if (io.existsSync(backup)) throw new Error('应用备份目录已存在');
  const operations = [];
  let usedDirectoryFallback = false;
  function move(from, to) {
    checked(from);
    checked(to);
    const directory = io.lstatSync(from).isDirectory();
    if (!io.existsSync(to)) {
      try {
        io.renameSync(from, to);
        operations.push({from, to});
        return;
      } catch (error) {
        if (!directory || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        usedDirectoryFallback = true;
      }
    } else if (!directory || !io.lstatSync(to).isDirectory()) {
      throw new Error(`应用更新目标已存在：${to}`);
    }
    if (!io.existsSync(to)) {
      io.mkdirSync(to);
      operations.push({createdDirectory: to});
    }
    for (const name of io.readdirSync(from)) move(path.join(from, name), path.join(to, name));
  }
  try {
    if (io.existsSync(installed)) move(installed, backup);
    move(staging, installed);
  } catch (error) {
    const rollbackErrors = [];
    for (const {from, to, createdDirectory} of operations.reverse()) {
      try {
        if (createdDirectory) io.rmdirSync(createdDirectory);
        else io.renameSync(to, from);
      }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `应用更新失败，恢复未完成；备份保存在 ${backup}`);
    throw error;
  }
  return {usedDirectoryFallback};
}

module.exports = {installApplication};
