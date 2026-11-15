/**
 * Business Intelligence & Web Data Query Engine
 * Mengintegrasikan database aplikasi web (keu.portal-egn.com, pos.portal-egn.com, dll.)
 * ke dalam asisten AI (Ollama) dan Bot WhatsApp / Web Portal.
 */

const { exec } = require('child_process');
const config = require('./config');

class BusinessIntelligence {
  constructor() {
    this.domainDbMap = {
      'keu.portal-egn.com': 'keu_egn',
      'keu.kedukanaksara.com': 'keu_egn',
      'keu': 'keu_egn',
      'keu_egn': 'keu_egn',
      'pos.portal-egn.com': 'pos_saas',
      'pos': 'pos_saas',
      'pos_saas': 'pos_saas',
      'pentest.portal-egn.com': 'pent_test',
      'polrestabespalembang.my.id': 'polr_palembang',
      'sriwijaya.portal-egn.com': 'sriw_plg',
      'ukp.portal-egn.com': 'ukp_bimbel',
      'smanegeri10palembang.sch.id': 'sman_10plg',
      'kedukanaksara.com': 'kedu_aksara',
      'portal-egn.com': 'port_portal'
    };
  }

  /**
   * Eksekusi query MySQL secara aman (Read-Only)
   */
  async executeSql(sql) {
    // Sanitasi: Hanya perbolehkan SELECT / SHOW / DESCRIBE (Strict Read-Only)
    const cleanSql = sql.trim();
    if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN)\s/i.test(cleanSql)) {
      throw new Error('Hanya query READ-ONLY (SELECT/SHOW/DESCRIBE) yang diperbolehkan.');
    }

    // Jika berjalan di VPS (Master), eksekusi mysql langsung
    if (config.clusterRole === 'master' || process.platform === 'linux') {
      return new Promise((resolve, reject) => {
        const cmd = `mysql --batch --raw -e "${cleanSql.replace(/"/g, '\\"')}"`;
        exec(cmd, { timeout: 10000, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve(this.parseTsv(stdout));
        });
      });
    }

    // Jika di Windows host (Standby), gunakan helper vps_exec
    try {
      const { execOnVps } = require('../scripts/vps_exec');
      const cmd = `mysql --batch --raw -e "${cleanSql.replace(/"/g, '\\"')}"`;
      const res = await execOnVps(cmd);
      if (res.code !== 0) throw new Error(res.stderr || 'MySQL error');
      return this.parseTsv(res.stdout);
    } catch (err) {
      throw new Error(`Gagal menghubungi server database: ${err.message}`);
    }
  }

  /**
   * Parse output tab-delimited MySQL ke Array of Object
   */
  parseTsv(tsv) {
    if (!tsv || !tsv.trim()) return [];
    const lines = tsv.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split('\t');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = parts[idx] !== undefined ? parts[idx] : null;
      });
      rows.push(row);
    }
    return rows;
  }

  formatRupiah(amount) {
    const num = Number(amount) || 0;
    return 'Rp ' + num.toLocaleString('id-ID');
  }

  /**
   * Laporan Keuangan keu.portal-egn.com (keu_egn)
   */
  async getFinancialReport(keyword = '') {
    const kw = String(keyword || '').trim().replace(/['"\\%_]/g, '');

    let sqlFilter = '';
    if (kw) {
      sqlFilter = `WHERE category LIKE '%${kw}%' OR description LIKE '%${kw}%'`;
    }

    // 1. Ringkasan Inflow vs Outflow
    const summarySql = `
      SELECT 
        type,
        category,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM keu_egn.cash_transactions
      ${sqlFilter}
      GROUP BY type, category
      ORDER BY type DESC, total_amount DESC;
    `;
    const summaryRows = await this.executeSql(summarySql);

    // 2. Transaksi Rinci Terbaru
    const detailSql = `
      SELECT 
        id, date, type, category, amount, description
      FROM keu_egn.cash_transactions
      ${sqlFilter}
      ORDER BY date DESC, id DESC
      LIMIT 25;
    `;
    const detailRows = await this.executeSql(detailSql);

    // 3. Hitung Agregat
    let totalInflow = 0;
    let totalOutflow = 0;
    let countInflow = 0;
    let countOutflow = 0;

    summaryRows.forEach(row => {
      const amt = Number(row.total_amount) || 0;
      const cnt = Number(row.count) || 0;
      if (row.type === 'inflow') {
        totalInflow += amt;
        countInflow += cnt;
      } else {
        totalOutflow += amt;
        countOutflow += cnt;
      }
    });

    const netCashflow = totalInflow - totalOutflow;

    return {
      domain: 'keu.portal-egn.com',
      database: 'keu_egn',
      keyword: kw || 'SEMUA TRANSAKSI',
      summary: {
        totalInflow,
        totalInflowFormatted: this.formatRupiah(totalInflow),
        totalOutflow,
        totalOutflowFormatted: this.formatRupiah(totalOutflow),
        netCashflow,
        netCashflowFormatted: this.formatRupiah(netCashflow),
        countInflow,
        countOutflow,
        totalTransactions: countInflow + countOutflow
      },
      categories: summaryRows.map(r => ({
        type: r.type,
        category: r.category,
        count: Number(r.count),
        total: Number(r.total_amount),
        totalFormatted: this.formatRupiah(r.total_amount)
      })),
      transactions: detailRows.map(d => ({
        id: d.id,
        date: d.date,
        type: d.type,
        category: d.category,
        amount: Number(d.amount),
        amountFormatted: this.formatRupiah(d.amount),
        description: d.description
      }))
    };
  }

  /**
   * Menghasilkan Laporan Teks Siap Cetak untuk WhatsApp & Portal
   */
  formatReportText(report) {
    const isFiltered = report.keyword !== 'SEMUA TRANSAKSI';
    let txt = `📊 *LAPORAN KEUANGAN (${report.domain})* 💰\n`;
    txt += `──────────────────────────────\n`;
    if (isFiltered) {
      txt += `🔍 *Kategori/Filter:* "${report.keyword}"\n`;
    }
    txt += `• *Total Pemasukan (Inflow):* ${report.summary.totalInflowFormatted} (${report.summary.countInflow} transaksi)\n`;
    txt += `• *Total Pengeluaran (Outflow):* ${report.summary.totalOutflowFormatted} (${report.summary.countOutflow} transaksi)\n`;
    txt += `• *Saldo Bersih (Net Cashflow):* ${report.summary.netCashflowFormatted}\n`;
    txt += `──────────────────────────────\n\n`;

    if (report.categories.length > 0) {
      txt += `📌 *Rincian Per Kategori:*\n`;
      report.categories.forEach(c => {
        const symbol = c.type === 'inflow' ? '🟢 +' : '🔴 -';
        txt += `${symbol} *${c.category}:* ${c.totalFormatted} (${c.count}x)\n`;
      });
      txt += `\n`;
    }

    if (report.transactions.length > 0) {
      txt += `📋 *Rincian Transaksi (${Math.min(report.transactions.length, 10)} Terakhir):*\n`;
      report.transactions.slice(0, 10).forEach((t, i) => {
        const sign = t.type === 'inflow' ? '+' : '-';
        txt += `${i + 1}. *${t.date}* | ${t.category}\n`;
        txt += `   ${sign}${t.amountFormatted} • _"${t.description}"_\n`;
      });
      if (report.transactions.length > 10) {
        txt += `   _(+${report.transactions.length - 10} transaksi lainnya)_\n`;
      }
      txt += `\n`;
    }

    txt += `_Sumber Data: Database keu_egn terverifikasi secara real-time._`;
    return txt;
  }

  /**
   * Deteksi apakah pertanyaan user berkaitan dengan database web
   */
  detectIntent(userText) {
    const lower = String(userText || '').toLowerCase();

    // Cek domain spesifik
    let targetDomain = null;
    let targetDb = null;
    for (const [d, db] of Object.entries(this.domainDbMap)) {
      if (lower.includes(d)) {
        targetDomain = d;
        targetDb = db;
        break;
      }
    }

    // Deteksi topik keuangan
    const isKeuangan = lower.includes('keu') || 
                      lower.includes('keuangan') || 
                      lower.includes('penjualan') || 
                      lower.includes('omset') || 
                      lower.includes('madu') || 
                      lower.includes('kas') || 
                      lower.includes('arus kas') || 
                      lower.includes('inflow') || 
                      lower.includes('outflow');

    if (!isKeuangan && !targetDomain) {
      return null;
    }

    // Ekstrak keyword pencarian
    let keyword = '';
    if (lower.includes('madu')) keyword = 'madu';
    else if (lower.includes('gaji')) keyword = 'gaji';
    else if (lower.includes('salon')) keyword = 'salon';
    else if (lower.includes('faktur')) keyword = 'faktur';
    else if (lower.includes('kasbon')) keyword = 'kasbon';
    else if (lower.includes('bahan')) keyword = 'bahan';

    return {
      type: 'financial',
      domain: targetDomain || 'keu.portal-egn.com',
      database: targetDb || 'keu_egn',
      keyword
    };
  }

  /**
   * Menjawab pertanyaan user dengan sintesis AI (Ollama) yang di-grounding dengan data real
   */
  async answerWithAiGrounded(userQuestion, senderJid = null) {
    const intent = this.detectIntent(userQuestion);
    if (!intent) return null;

    try {
      const report = await this.getFinancialReport(intent.keyword);
      const textSummary = this.formatReportText(report);

      // Coba sintesis dengan Ollama untuk gaya bahasa interaktif
      let aiAnalysis = '';
      try {
        const prompt = `Anda adalah Asisten Keuangan & Eksekutif AI resmi untuk portal web keu.portal-egn.com (PT Expro Gio Nusantara).
Berikut adalah DATA REAL-TIME yang ditarik langsung dari database keu_egn:
--------------------------------------------------
${textSummary}
--------------------------------------------------
Pertanyaan Admin: "${userQuestion}"

Instruksi:
1. Berikan jawaban yang ramah, profesional, dan akurat berdasarkan DATA REAL di atas.
2. Jelaskan total angka penjualan/pemasukan, rincian per kategori produk (seperti Madu Mangium, Madu Carpa), dan total transaksi.
3. Sebutkan nama-nama pembeli/catatan jika relevan (misal: Willy, Mangium Putra, dll).
4. Gunakan format Bahasa Indonesia yang rapi dengan bullet points.`;

        const res = await fetch(`${config.ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.ollamaModel,
            prompt,
            stream: false
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
          const d = await res.json();
          if (d.response) {
            aiAnalysis = d.response.trim();
          }
        }
      } catch {
        // Fallback jika Ollama timeout: gunakan format teks langsung
      }

      if (aiAnalysis) {
        return `${aiAnalysis}\n\n──────────────────────────────\n${textSummary}`;
      } else {
        return textSummary;
      }
    } catch (err) {
      console.error('[BusinessIntelligence Error]:', err.message);
      return null;
    }
  }
}

module.exports = new BusinessIntelligence();
