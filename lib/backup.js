'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');

const BEHALTEN = 30;

/**
 * Einmal pro Tag beim Start eine Kopie aller Datendateien ablegen.
 * Läuft still: ein fehlgeschlagenes Backup darf den Serverstart nicht verhindern.
 */
const taeglich = () => {
  try {
    store.ensureDirs();
    const config = store.read('config.json');
    const tag = store.heute();
    if (config.letztesBackup === tag) return { erstellt: false, grund: 'heute schon gesichert' };

    const dateien = fs.readdirSync(store.DATA_DIR).filter((n) => n.endsWith('.json'));
    if (!dateien.length) return { erstellt: false, grund: 'noch keine Daten' };

    const ziel = path.join(store.BACKUP_DIR, tag);
    if (!fs.existsSync(ziel)) fs.mkdirSync(ziel, { recursive: true });
    for (const datei of dateien) {
      fs.copyFileSync(path.join(store.DATA_DIR, datei), path.join(ziel, datei));
    }

    store.write('config.json', { ...config, letztesBackup: tag });
    aufraeumen();
    return { erstellt: true, ordner: tag };
  } catch (fehler) {
    return { erstellt: false, grund: fehler.message };
  }
};

const aufraeumen = () => {
  const ordner = fs.readdirSync(store.BACKUP_DIR)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();
  for (const alt of ordner.slice(0, Math.max(0, ordner.length - BEHALTEN))) {
    fs.rmSync(path.join(store.BACKUP_DIR, alt), { recursive: true, force: true });
  }
};

module.exports = { taeglich, BEHALTEN };
