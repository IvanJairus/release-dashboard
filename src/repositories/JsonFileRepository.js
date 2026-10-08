"use strict";

const fs = require("node:fs");
const path = require("node:path");

/*
  One JSON file per collection, written atomically. A control plane that owns
  the release calendar cannot be the thing that corrupts its own record, so a
  save goes to a sibling temp file and then rename()s over the original -
  rename is atomic on every filesystem this runs on, so a crash mid-write
  leaves the previous good file in place instead of half a JSON document.
*/
class JsonFileRepository {
  constructor(dir) {
    this.dir = dir;
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  async read(name, fallback) {
    try {
      return JSON.parse(await fs.promises.readFile(this.file(name), "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return fallback;
      throw err;
    }
  }

  async write(name, value) {
    const target = this.file(name);
    const tmp = `${target}.${process.pid}.tmp`;
    const handle = await fs.promises.open(tmp, "w");
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmp, target);
    return value;
  }
}

module.exports = { JsonFileRepository };
