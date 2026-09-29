import { NextResponse } from 'next/server';
import { turso } from '../../../lib/turso';

let cacheStore = { examPack: {}, lastFetchTime: 0 };
const CACHE_TTL = 5 * 60 * 1000;

export async function POST(req) {
  try {
    const { action, args } = await req.json();

    if (action === 'getPublicSessions') {
      try {
          const sessionsQuery = await turso.execute("SELECT * FROM Sessions ORDER BY SesiID ASC");
          return NextResponse.json({ status: 'success', data: sessionsQuery.rows });
      } catch (error) {
          return NextResponse.json({ status: 'success', data: [
              {SesiID: '1', JamMulai: '07:30', JamSelesai: '09:00'},
              {SesiID: '2', JamMulai: '09:30', JamSelesai: '11:00'},
              {SesiID: '3', JamMulai: '11:30', JamSelesai: '13:00'},
              {SesiID: '4', JamMulai: '13:30', JamSelesai: '15:00'}
          ]});
      }
    }

    if (action === 'getDashboardData') {
      const [role, userId, , sekolah] = args; 
      let exams, users;
      
      if (role === 'guru') {
        exams = await turso.execute("SELECT * FROM Exams WHERE Mapel != 'SURVEY'");
        users = await turso.execute({ sql: "SELECT * FROM Users WHERE Role = 'siswa' AND LOWER(TRIM(Sekolah)) = LOWER(TRIM(?))", args: [sekolah] });
      } else {
        exams = await turso.execute("SELECT * FROM Exams WHERE Mapel != 'SURVEY'");
        users = await turso.execute("SELECT * FROM Users WHERE Role = 'siswa'");
      }
      
      let output = { logo: 'https://lh3.googleusercontent.com/d/1IWNmSpAZfMOYOU0uNK2RIiD83Zr63ye9' };
      
      if (role === 'admin' || role === 'guru') {
        output.exams = exams.rows;
        output.stats = { totalSiswa: users.rows.length, totalUjian: exams.rows.length, activeUjian: exams.rows.filter(e => e.Status === 'Aktif').length };

        const schoolRankQuery = await turso.execute(`SELECT u.Sekolah, AVG(r.TotalNilai) as RataRata FROM Results r JOIN Users u ON r.SiswaID = u.ID JOIN Exams e ON r.ExamID = e.ExamID WHERE e.Mapel != 'SURVEY' ${role === 'guru' ? "AND e.ShowStats IN ('Yes', 'Aktif')" : ""} GROUP BY u.Sekolah ORDER BY RataRata DESC`);
        output.schoolRanks = schoolRankQuery.rows;

        if (role === 'guru') {
            const studentRankQuery = await turso.execute({ sql: `SELECT u.Nama, e.Mapel, AVG(r.TotalNilai) as RataRata FROM Results r JOIN Users u ON r.SiswaID = u.ID JOIN Exams e ON r.ExamID = e.ExamID WHERE LOWER(TRIM(u.Sekolah)) = LOWER(TRIM(?)) AND e.Mapel != 'SURVEY' AND e.ShowStats IN ('Yes', 'Aktif') GROUP BY u.ID, e.Mapel ORDER BY e.Mapel ASC, RataRata DESC`, args: [sekolah] });
            output.studentRanks = studentRankQuery.rows;
        }
        
        const sessionsQuery = await turso.execute("SELECT * FROM Sessions ORDER BY SesiID ASC");
        output.sessions = sessionsQuery.rows;

      } else if (role === 'siswa') {
        const userStatusQ = await turso.execute({ sql: "SELECT Status, Sesi, JenisPeserta FROM Users WHERE ID = ?", args: [userId] });
        output.userStatus = userStatusQ.rows.length > 0 ? userStatusQ.rows[0].Status : '';
        
        const userSesi = userStatusQ.rows.length > 0 ? (userStatusQ.rows[0].Sesi || '1') : '1';
        const userJenis = userStatusQ.rows.length > 0 ? (userStatusQ.rows[0].JenisPeserta || 'Umum') : 'Umum';

        const mySessionQ = await turso.execute({ sql: "SELECT * FROM Sessions WHERE SesiID = ?", args: [userSesi] });
        output.mySession = mySessionQ.rows.length > 0 ? mySessionQ.rows[0] : { SesiID: '1', NamaSesi: 'Sesi 1', JamMulai: '00:00', JamSelesai: '23:59' };

        output.availableExams = exams.rows.filter(e => {
            const isJenisMatch = (!e.JenisPeserta || e.JenisPeserta === 'ALL' || e.JenisPeserta === userJenis);
            return e.Status === 'Aktif' && isJenisMatch;
        });

        const history = await turso.execute({ sql: "SELECT r.ResultID, r.ExamID, r.WaktuSubmit, r.TotalNilai as Nilai, e.Judul, e.AllowDownloadR, e.AllowDownloadQ, e.ShowStats, r.Pelanggaran FROM Results r JOIN Exams e ON r.ExamID = e.ExamID WHERE r.SiswaID = ? AND e.Mapel != 'SURVEY'", args: [userId] });
        output.history = history.rows;
      }
      return NextResponse.json({ status: 'success', data: output });
    }

    if (action === 'getAdminData') {
      const [role, , , sekolah] = args;
      let exams, users;
      if (role === 'guru') {
        exams = await turso.execute("SELECT * FROM Exams");
        users = await turso.execute({ sql: "SELECT * FROM Users WHERE Role = 'siswa' AND LOWER(TRIM(Sekolah)) = LOWER(TRIM(?))", args: [sekolah] });
      } else {
        exams = await turso.execute("SELECT * FROM Exams");
        users = await turso.execute("SELECT * FROM Users WHERE Role = 'siswa'");
      }
      return NextResponse.json({ status: 'success', exams: exams.rows, users: users.rows, logo: 'https://lh3.googleusercontent.com/d/1IWNmSpAZfMOYOU0uNK2RIiD83Zr63ye9' });
    }

    if (action === 'getUserList') {
      const [role, , sekolah] = args;
      let users;
      if (role === 'guru') users = await turso.execute({ sql: "SELECT * FROM Users WHERE Role = 'siswa' AND LOWER(TRIM(Sekolah)) = LOWER(TRIM(?))", args: [sekolah] });
      else users = await turso.execute("SELECT * FROM Users"); 
      return NextResponse.json({ status: 'success', data: users.rows });
    }

    if (action === 'adminManageUser') {
      const mode = args[0]; const d = args[1];
      if (mode === 'save') {
        const id = d.id || ('U' + Date.now());
        const sesi = d.sesi || '1';
        const jenis = d.jenis || 'Umum';
        
        const cek = await turso.execute({ sql: "SELECT ID FROM Users WHERE ID = ?", args: [id] });
        if (cek.rows.length > 0) {
          await turso.execute({ sql: "UPDATE Users SET Nama=?, Username=?, Password=?, Role=?, Sekolah=?, TglLahir=?, Foto=?, Sesi=?, JenisPeserta=? WHERE ID=?", args: [d.nama, d.username, d.password, d.role, d.sekolah, d.tglLahir, d.foto, sesi, jenis, id] });
        } else {
          await turso.execute({ sql: "INSERT INTO Users (ID, Nama, Username, Password, Role, Sekolah, TglLahir, Foto, Sesi, JenisPeserta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [id, d.nama, d.username, d.password, d.role, d.sekolah, d.tglLahir, d.foto, sesi, jenis] });
        }
      } else if (mode === 'delete') {
        await turso.execute({ sql: "DELETE FROM Users WHERE ID = ?", args: [d.id] });
      }
      return NextResponse.json({ status: 'success', msg: 'Data Peserta berhasil disimpan!' });
    }
    
    if (action === 'adminSetKelulusan') {
      const [userIds, statusVal] = args;
      for (let uid of userIds) { await turso.execute({ sql: "UPDATE Users SET Status=? WHERE ID=?", args: [statusVal, uid] }); }
      return NextResponse.json({ status: 'success', msg: `Berhasil mengatur status ${statusVal}!` });
    }

    if (action === 'adminSaveSession') {
      const data = args[0]; 
      for (let s of data) {
          await turso.execute({ sql: "UPDATE Sessions SET JamMulai=?, JamSelesai=? WHERE SesiID=?", args: [s.mulai, s.selesai, s.id] });
      }
      return NextResponse.json({ status: 'success', msg: 'Waktu Sesi Berhasil Diperbarui!' });
    }

    if (action === 'adminSaveExam') {
      const d = args[0]; const id = d.examId || ('EX' + Date.now());
      const targetKelas = 'ALL'; 
      const jenisPeserta = d.jenisPeserta || 'ALL';

      const cek = await turso.execute({ sql: "SELECT ExamID FROM Exams WHERE ExamID = ?", args: [id] });
      if (cek.rows.length > 0) { 
          await turso.execute({ sql: "UPDATE Exams SET Judul=?, Mapel=?, TargetKelas=?, Durasi=?, Token=?, StartDate=?, EndDate=?, LimitTries=?, ShowStats=?, RandomQ=?, AllowDownloadQ=?, AllowDownloadR=?, JenisPeserta=?, Status='Aktif' WHERE ExamID=?", args: [d.judul, d.mapel, targetKelas, d.durasi, d.token || '', d.start, d.end, d.limit || 1, d.showStats, d.randomQ, d.dlSoal, d.dlHasil, jenisPeserta, id] });
      } else { 
          await turso.execute({ sql: "INSERT INTO Exams (ExamID, Judul, Mapel, TargetKelas, Durasi, Token, StartDate, EndDate, LimitTries, ShowStats, RandomQ, AllowDownloadQ, AllowDownloadR, PembuatID, ActiveSession, JenisPeserta, Status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ALL', ?, 'Aktif')", args: [id, d.judul, d.mapel, targetKelas, d.durasi, d.token || '', d.start, d.end, d.limit || 1, d.showStats, d.randomQ, d.dlSoal, d.dlHasil, d.userId, jenisPeserta] }); 
      }
      return NextResponse.json({ status: 'success', msg: 'Jadwal Ujian berhasil dibuat!' });
    }

    if (action === 'adminDeleteExam') { await turso.execute({ sql: "DELETE FROM Exams WHERE ExamID = ?", args: [args[0]] }); return NextResponse.json({ status: 'success' }); }

    if (action === 'getExamQuestions' || action === 'getSiswaSoal') {
      const qs = await turso.execute({ sql: "SELECT * FROM Questions WHERE ExamID = ?", args: [args[0]] });
      return NextResponse.json(qs.rows);
    }

    if (action === 'adminSaveSingleQuestion') {
      const eid = args[0]; const d = args[1]; const userId = args[2]; const id = d.id || ('Q' + Date.now());
      const kategori = d.kategori || 'Profesional';
      const cek = await turso.execute({ sql: "SELECT QID FROM Questions WHERE QID = ?", args: [id] });
      
      if (cek.rows.length > 0) {
        await turso.execute({ sql: "UPDATE Questions SET Tipe=?, Pertanyaan=?, Options=?, Key=?, Skor=?, Nomor=?, Kategori=? WHERE QID=?", args: [d.type, d.text, JSON.stringify(d.options), JSON.stringify(d.key), d.score, d.num, kategori, id] });
      } else {
        await turso.execute({ sql: "INSERT INTO Questions (QID, ExamID, Tipe, Pertanyaan, Options, Key, Skor, Nomor, PembuatID, Kategori) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [id, eid, d.type, d.text, JSON.stringify(d.options), JSON.stringify(d.key), d.score, d.num, userId, kategori] });
      }
      return NextResponse.json({ status: 'success', id: id, msg: 'Soal tersimpan!' });
    }

    if (action === 'adminDeleteQuestion') { await turso.execute({ sql: "DELETE FROM Questions WHERE QID = ?", args: [args[0]] }); return NextResponse.json({ status: 'success' }); }

    if (action === 'adminBatchSaveQuestions') {
      const eid = args[0]; const qArr = args[1]; const userId = args[2];
      for(let q of qArr) {
         const id = 'Q' + Date.now() + Math.floor(Math.random()*1000);
         const kategori = q.kategori || 'Profesional';
         await turso.execute({ sql: "INSERT INTO Questions (QID, ExamID, Tipe, Pertanyaan, Options, Key, Skor, Nomor, PembuatID, Kategori) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [id, eid, q.type, q.text, JSON.stringify(q.options), JSON.stringify(q.key), q.score, q.num, userId, kategori] });
      }
      return NextResponse.json({ status: 'success', msg: `${qArr.length} soal diupload!` });
    }

    if (action === 'adminSaveSurvey') {
      const d = args[0]; const id = d.id || ('SRV' + Date.now());
      const cek = await turso.execute({ sql: "SELECT ExamID FROM Exams WHERE ExamID = ?", args: [id] });
      if (cek.rows.length > 0) {
          await turso.execute({ sql: "UPDATE Exams SET Judul=?, TargetKelas=?, ShowStats=?, Token=? WHERE ExamID=?", args: [d.judul, d.desc, d.status, d.linkedExam, id] });
      } else {
          await turso.execute({ sql: "INSERT INTO Exams (ExamID, Judul, Mapel, TargetKelas, Durasi, Token, StartDate, EndDate, LimitTries, ShowStats, RandomQ, AllowDownloadQ, AllowDownloadR, PembuatID, ActiveSession, JenisPeserta, Status) VALUES (?, ?, 'SURVEY', ?, 0, ?, '', '', 1, ?, 'No', 'No', 'No', ?, 'ALL', 'ALL', 'Aktif')", args: [id, d.judul, d.desc, d.linkedExam, d.status, d.userId] });
      }
      return NextResponse.json({ status: 'success', msg: 'Survey ditautkan & disimpan!' });
    }

    if (action === 'checkActiveSurvey') {
        const finishedExamId = args[0]; 
        const srv = await turso.execute({
            sql: "SELECT * FROM Exams WHERE Mapel='SURVEY' AND Token=? AND ShowStats='Aktif' LIMIT 1",
            args: [finishedExamId]
        });
        if(srv.rows.length > 0) {
            const qs = await turso.execute({ sql: "SELECT * FROM Questions WHERE ExamID = ?", args: [srv.rows[0].ExamID] });
            return NextResponse.json({ status: 'success', data: { header: srv.rows[0], qs: qs.rows } });
        }
        return NextResponse.json({ status: 'empty' });
    }

    if (action === 'submitSurveyResponse') {
        const uid = args[0]; const sid = args[1]; const answers = args[2]; const waktuSubmit = args[3];
        await turso.execute({ 
           sql: "INSERT INTO Results (ResultID, SiswaID, ExamID, TotalNilai, Detail, Pelanggaran, WaktuSubmit) VALUES (?, ?, ?, 0, ?, 'Survey Response', ?)", 
           args: ['SRES' + Date.now(), uid, sid, JSON.stringify(answers), waktuSubmit] 
        });
        try { await turso.execute({ sql: "UPDATE Users SET Status='Survei Selesai', Terjawab=TotalSoal WHERE ID=?", args: [uid] }); } catch(e){}
        return NextResponse.json({ status: 'success', msg: 'Survey dikirim' });
    }

    if (action === 'getExamPack') {
      const eid = args[0]; const uid = args[1];
      const history = await turso.execute({ sql: "SELECT * FROM Results WHERE ExamID=? AND SiswaID=?", args: [eid, uid]});
      if(history.rows.length > 0) return NextResponse.json({status: 'error', msg: 'Ujian sudah dikerjakan.'});
      
      const now = Date.now();
      if (!cacheStore.examPack[eid] || (now - cacheStore.lastFetchTime > CACHE_TTL)) {
          const examInfo = await turso.execute({ sql: "SELECT * FROM Exams WHERE ExamID=?", args:[eid] });
          const qs = await turso.execute({ sql: "SELECT * FROM Questions WHERE ExamID=?", args:[eid] });
          const cleanQ = qs.rows.map(q => ({ QID: q.QID, Tipe: q.Tipe, Pertanyaan: q.Pertanyaan, Options: q.Options, Nomor: q.Nomor, Kategori: q.Kategori || 'Profesional', Extra: [] }));
          cacheStore.examPack[eid] = { data: cleanQ, duration: examInfo.rows[0].Durasi, judul: examInfo.rows[0].Judul, token: examInfo.rows[0].Token, randomQ: examInfo.rows[0].RandomQ };
          cacheStore.lastFetchTime = now;
      }
      return NextResponse.json({ status: 'success', data: cacheStore.examPack[eid].data, duration: cacheStore.examPack[eid].duration, judul: cacheStore.examPack[eid].judul, token: cacheStore.examPack[eid].token, randomQ: cacheStore.examPack[eid].randomQ });
    }

    if (action === 'submitExam') {
       const uid = args[0]; const eid = args[1]; const answers = args[2]; const violations = args[3]; const waktuSubmit = args[4];
       let rawTotalScore = 0; let detailLog = [];

       const qs = await turso.execute({ sql: "SELECT * FROM Questions WHERE ExamID=?", args:[eid] });

       answers.forEach(ans => {
          const q = qs.rows.find(x => x.QID === ans.qid);
          if(q) {
             const keys = JSON.parse(q.Key || "[]");
             let scoreEarned = 0;
             const maxSkor = Number(q.Skor) || 0;

             if (q.Tipe === 'PGK') {
                 if (Array.isArray(ans.answer)) {
                     const correct_selected = ans.answer.filter(val => keys.includes(val)).length;
                     const wrong_selected = ans.answer.filter(val => !keys.includes(val)).length;
                     const total_correct_keys = keys.length;
                     if (total_correct_keys > 0) { let partial = (correct_selected - wrong_selected) / total_correct_keys; if (partial < 0) partial = 0; scoreEarned = partial * maxSkor; }
                 }
             } else if (q.Tipe === 'PGKK') {
                 if (Array.isArray(ans.answer)) {
                     let correct_match = 0; const total_statements = keys.length;
                     ans.answer.forEach((val, idx) => { if (val && val === keys[idx]) correct_match++; });
                     if (total_statements > 0) { scoreEarned = (correct_match / total_statements) * maxSkor; }
                 }
             } else if (q.Tipe === 'PGS') { if (keys.includes(ans.answer)) scoreEarned = maxSkor;
             } else {
                 if (Array.isArray(ans.answer)) { if (JSON.stringify(ans.answer) === JSON.stringify(keys)) scoreEarned = maxSkor; } else { if (keys.includes(ans.answer)) scoreEarned = maxSkor; }
             }
             
             scoreEarned = Math.round(scoreEarned * 100) / 100;
             rawTotalScore += scoreEarned;
             detailLog.push({ i: q.Nomor, s: scoreEarned, m: maxSkor, t: q.Tipe, a: ans.answer, k: q.Kategori || 'Profesional' });
          }
       });

       let finalScore = Math.round(rawTotalScore * 100) / 100;

       await turso.execute({ sql: "INSERT INTO Results (ResultID, SiswaID, ExamID, TotalNilai, Detail, Pelanggaran, WaktuSubmit) VALUES (?, ?, ?, ?, ?, ?, ?)", args: ['RES' + Date.now(), uid, eid, finalScore, JSON.stringify(detailLog), violations > 0 ? `Pelanggaran: ${violations}x` : "-", waktuSubmit] });
       try { await turso.execute({ sql: "UPDATE Users SET Status='Selesai CAT BCKS', Terjawab=0 WHERE ID=?", args: [uid] }); } catch(e){}
       return NextResponse.json({ status: 'success', data: { score: finalScore } });
    }

    if (action === 'getRecapList') {
      const [role, , sekolah] = args;
      let sql = `SELECT r.ResultID, r.TotalNilai, r.WaktuSubmit, r.Detail, r.SiswaID, r.ExamID, r.Pelanggaran, u.Nama AS NamaSiswa, u.Sekolah AS SekolahSiswa, u.Sesi AS SesiSiswa, e.Judul AS JudulUjian, e.Mapel AS Mapel, e.PembuatID AS PembuatID, e.ShowStats AS ShowStats, (SELECT Nama FROM Users WHERE ID = e.PembuatID) AS PembuatNama FROM Results r LEFT JOIN Users u ON r.SiswaID = u.ID LEFT JOIN Exams e ON r.ExamID = e.ExamID WHERE 1=1`;
      let pArgs = [];
      if (role === 'guru') { sql += ` AND LOWER(TRIM(u.Sekolah)) = LOWER(TRIM(?))`; pArgs.push(sekolah); }
      const results = await turso.execute({ sql: sql, args: pArgs });
      return NextResponse.json({ status: 'success', data: results.rows });
    }

    if (action === 'getSiswaDetailHasil') {
      const rid = args[0];
      const results = await turso.execute({ sql: "SELECT r.TotalNilai, r.Detail, e.Judul, e.Mapel FROM Results r JOIN Exams e ON r.ExamID = e.ExamID WHERE r.ResultID = ?", args: [rid] });
      return NextResponse.json({ status: 'success', data: results.rows[0] });
    }

    if (action === 'adminDeleteResult') { await turso.execute({ sql: "DELETE FROM Results WHERE ResultID=?", args: [args[0]] }); return NextResponse.json({ status: 'success' }); }
    if (action === 'requestResetResult') { await turso.execute({ sql: "UPDATE Results SET Pelanggaran = 'Meminta Reset (Trobel)' WHERE ResultID=?", args: [args[0]] }); return NextResponse.json({ status: 'success' }); }
    if (action === 'updateClientProgress' || action === 'sysResetCache' || action === 'autosaveAnswer') { return NextResponse.json({ status: 'success' }); }
    
    return NextResponse.json({ status: 'success', data: [] });
  } catch (error) {
    return NextResponse.json({ status: 'error', msg: error.message }, { status: 500 });
  }
}
