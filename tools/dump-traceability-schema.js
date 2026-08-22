/**
 * พิมพ์โครงตารางและค่า enum ทั้งหมดออกมาเป็น JSON
 * รันด้วย: node tools/dump-traceability-schema.js
 *
 * ทำไมต้องมี: ตัวสร้างไฟล์ Excel จะได้อ่านโครงสร้างจาก 00_Config.gs ตัวจริง
 * ไม่ใช่พิมพ์ซ้ำไว้อีกที่ — ไม่งั้นวันหนึ่งสองที่จะไม่ตรงกันโดยไม่มีใครรู้
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'apps-script', 'traceability', '00_Config.gs');
const sandbox = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: '00_Config.gs' });

process.stdout.write(JSON.stringify({
  app_version: sandbox.APP_VERSION,
  tab: sandbox.TAB,
  sap_tabs: sandbox.SAP_TABS,
  schema: sandbox.SCHEMA,
  enums: {
    MNG: sandbox.MNG,
    OBJ: sandbox.OBJ,
    OUTBOUND_TO_CUSTOMER: sandbox.OUTBOUND_TO_CUSTOMER,
    CASE_STATUS: sandbox.CASE_STATUS,
    TRACK_STATUS: sandbox.TRACK_STATUS,
    REQUIRED_ACTION: sandbox.REQUIRED_ACTION,
    RISK_CLASS: sandbox.RISK_CLASS,
    CASE_SOURCE: sandbox.CASE_SOURCE,
    ACTION_SECTIONS: sandbox.ACTION_SECTIONS,
    ROLES: sandbox.ROLES
  },
  perm: sandbox.PERM
}, null, 2));
