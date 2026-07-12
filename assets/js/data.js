/*
 * data.js — built-in DEFAULTS for "Side A" (catalog YS-004).
 *
 * This object is the bottom layer of the load order:
 *   DEFAULTS  ->  content.json  ->  KV (/api/content)  ->  localStorage
 * Because it is baked into the page, the site is NEVER blank and NEVER
 * depends on a network request. Everything here is safe to edit in /edit.
 *
 * All reader-facing copy is Indonesian (sentence case). Code is English.
 */
window.SIDE_A_DEFAULTS = {
  passcode: "salju2026",
  catalog_no: "YS-004",
  label: "Kamu dan Aku",
  artist_a: "Kamu",
  artist_b: "Aku",
  album_title: "Salju Pertama",
  start_date: "2026-03-17", // drives runtime, groove rings, and every countdown
  song_url: "audio/side-a.mp3", // path or a data URL from the editor

  liner_notes:
    "Sayang,\n\n" +
    "Aku nggak pinter nulis surat, jadi aku bikin yang ini aja. Anggap ini sisi A dari sesuatu yang aku harap panjang. Empat bulan kedengerannya sebentar, tapi entah kenapa berasa kayak aku udah lama kenal kamu.\n\n" +
    "Aku suka hal-hal kecil yang kamu nggak sadar kamu lakuin. Cara kamu inget hal yang aku sendiri lupa. Cara kamu bilang hati-hati tiap aku pulang. Aku ngerekam semuanya diam-diam, jadi ada di sini semua, jadi lagu, jadi track.\n\n" +
    "Aku nggak janji semuanya bakal mulus. Tapi aku janji bakal terus nekan tombol rekam. Setiap bulan aku bakal tambahin track baru di sini, sampai sisinya penuh, terus kita balik ke sisi B.\n\n" +
    "Makasih udah mau jadi pendengar satu-satunya.",

  tracks: [
    { n: 1,  title: "Awal Sisi A",        date: "2026-03-17", story: "Hari kita mutusin buat mulai. Aku inget gugupnya lebih jelas daripada kata-katanya.", photo: "", commentary: "" },
    { n: 2,  title: "Chat Sampai Subuh",  date: "2026-03-21", story: "Ngobrol sampai lupa waktu, terus baru sadar besok dua-duanya ada kelas pagi.", photo: "", commentary: "" },
    { n: 3,  title: "Ketemu Pertama",     date: "2026-03-28", story: "Pertama kali ketemu langsung. Aku dateng kepagian, kamu dateng pas, dan itu udah kayak kita banget.", photo: "", commentary: "" },
    { n: 4,  title: "Hujan Bulan Maret",  date: "2026-03-31", story: "Kehujanan bareng, nunggu redanya sambil pura-pura nggak buru-buru pulang.", photo: "", commentary: "" },
    { n: 5,  title: "Kopi Kependinginan", date: "2026-04-08", story: "Ngobrol kelamaan sampai kopinya dingin dua-duanya. Nggak ada yang protes.", photo: "", commentary: "" },
    { n: 6,  title: "Playlist Berdua",    date: "2026-04-15", story: "Mulai satu playlist yang isinya lagu-lagu yang cuma ngerti kalau kamu yang jelasin.", photo: "", commentary: "" },
    { n: 7,  title: "Jalan Kaki Kelamaan",date: "2026-04-22", story: "Niatnya sebentar, malah muter-muter cuma biar belum harus pisah.", photo: "", commentary: "" },
    { n: 8,  title: "Ketawa Nggak Jelas", date: "2026-05-02", story: "Ketawa gara-gara hal yang kalau diceritain ke orang pasti garing. Tapi kita ngerti.", photo: "", commentary: "" },
    { n: 9,  title: "Nonton yang Ketiduran", date: "2026-05-11", story: "Niat nonton sampai habis, kamu ketiduran di menit dua puluh dan aku nggak tega ganti film.", photo: "", commentary: "" },
    { n: 10, title: "Ujan-ujanan",        date: "2026-05-20", story: "Sengaja nggak pakai payung sekali-kali. Ternyata seru, walau besoknya pilek.", photo: "", commentary: "" },
    { n: 11, title: "Berantem Pertama",   date: "2026-05-29", story: "Track yang paling susah aku masukin. Tapi ini bagian dari albumnya juga.", photo: "", commentary: "" },
    { n: 12, title: "Baikan di Chat",     date: "2026-05-30", story: "Besoknya kita baikan lewat pesan panjang. Aku simpan yang itu.", photo: "", commentary: "" },
    { n: 13, title: "Foto yang Blur",     date: "2026-06-09", story: "Foto paling jelek, mata merem dua-duanya, tapi entah kenapa yang ini yang aku suka.", photo: "", commentary: "" },
    { n: 14, title: "Rencana Kecil",      date: "2026-06-19", story: "Mulai ngomongin hal-hal 'nanti kita', walau baru sebatas mau jajan di mana.", photo: "", commentary: "" },
    { n: 15, title: "Malam Panjang",      date: "2026-06-30", story: "Salah satu malam yang aku harap nggak buru-buru pagi.", photo: "", commentary: "" },
    { n: 16, title: "Bulan Keempat",      date: "2026-07-17", story: "Sampai di sini. Empat bulan. Masih di sisi A, masih banyak ruang kosong buat diisi.", photo: "", commentary: "" }
  ],

  hidden_track: {
    unlock_date: "2026-07-17", // the 4th monthsversary — the time capsule opens on the day
    message:
      "Kalau kamu baca ini, berarti udah tanggal 17 dan track-nya kebuka.\n\n" +
      "Aku nyimpen satu hal yang belum sempat aku bilang langsung: aku nggak nganggep ini proyek sebulan. Aku bikin tempat ini biar bisa aku isi terus, sampai track-nya nggak muat lagi.\n\n" +
      "Selamat empat bulan, Sayang. Sisi B nanti kita isi bareng."
  },

  // 100 Alasan — the credits / lyric sheet. Distinct, specific, no filler.
  reasons: [
    "Cara kamu ketawa waktu sesuatu benar-benar lucu, sampai lupa nutup mulut.",
    "Kamu selalu inget hal kecil yang aku sendiri lupa pernah cerita.",
    "Suara kamu pas pagi, masih setengah ngantuk tapi tetap manggil nama aku.",
    "Kamu nggak pernah bikin aku ngerasa jadi terlalu banyak buat kamu.",
    "Cara kamu ngerapiin rambut sebelum difoto, padahal udah rapi.",
    "Kamu dengerin cerita paling nggak penting sekalipun sampai habis.",
    "Tangan kamu yang selalu lebih dingin dari punyaku.",
    "Kamu berani jujur walaupun tahu itu bakal bikin suasana canggung.",
    "Cara kamu bilang hati-hati di jalan tiap aku mau pulang.",
    "Kamu suka ketawa duluan sebelum sampai ke bagian lucunya.",
    "Cara kamu ngambek yang nggak pernah lebih dari sepuluh menit.",
    "Kamu inget pesanan makanan aku lebih hafal dari aku sendiri.",
    "Kamu selalu nanya udah makan belum sebelum nanya yang lain.",
    "Cara mata kamu ngecil kalau senyumnya beneran.",
    "Kamu nyimpen struk atau tiket dari tempat yang kita datangi.",
    "Kamu nggak pernah malu jadi diri sendiri di depan aku.",
    "Cara kamu mikir lama sebelum jawab pertanyaan yang penting.",
    "Kamu ngasih tahu kalau aku salah, bukan diem-diem kecewa.",
    "Kamu bisa bikin hari biasa jadi kayak ada yang dirayain.",
    "Cara kamu megang tangan aku lebih erat pas nyebrang.",
    "Kamu sabar sama aku di hari-hari aku lagi nggak enak.",
    "Kamu peluk dari belakang tanpa bilang apa-apa pas tahu aku capek.",
    "Cara kamu ngomong sama orang tua kamu di telepon.",
    "Kamu selalu bagi setengah dari apa pun yang kamu makan.",
    "Kamu inget tanggal-tanggal yang buat aku cuma angka.",
    "Cara kamu ngetik lagi apa pas lagi kangen tapi gengsi ngaku.",
    "Kamu nggak pura-pura ngerti kalau emang nggak ngerti.",
    "Kamu ketawain lawakan garing aku, walau sambil ngeledek.",
    "Cara kamu tidur miring ke arah aku.",
    "Kamu minta maaf duluan walau bukan cuma kamu yang salah.",
    "Kamu simpan foto-foto kita walau blur atau mata merem.",
    "Cara kamu bilang aku juga tanpa harus aku selesaikan kalimatnya.",
    "Kamu perhatiin aku minum air yang cukup atau nggak.",
    "Kamu semangat cerita soal hal yang kamu suka, matanya beda.",
    "Cara kamu ngezoom foto makanan dulu sebelum makan.",
    "Kamu tetap milih aku di hari aku susah dipilih.",
    "Kamu nggak pernah bandingin aku sama siapa-siapa.",
    "Cara kamu bilang besok lagi ya biar perpisahannya nggak berat.",
    "Kamu inget aku takut apa, dan nggak pernah jadiin itu bahan bercanda.",
    "Kamu bikin aku pengen jadi orang yang lebih baik, tanpa nyuruh.",
    "Cara kamu narik selimut sampai ke dagu.",
    "Kamu percaya sama mimpi-mimpi aku bahkan pas aku ragu sendiri.",
    "Kamu balas chat aku lama, tapi selalu dibales.",
    "Cara kamu nyebut nama aku pas lagi kesel, beda sama biasanya.",
    "Kamu suka nyanyi kecil-kecil pas ngira nggak ada yang denger.",
    "Kamu nemenin aku diam tanpa harus ada obrolan.",
    "Cara kamu ngambil makanan yang aku nggak suka dari piring aku.",
    "Kamu inget cerita masa kecil aku dan nanyain lagi kapan-kapan.",
    "Kamu nggak pernah bikin aku nunggu buat tahu perasaan kamu.",
    "Cara kamu bilang capek ya hari ini, dan itu udah cukup.",
    "Kamu berani coba hal baru asal barengan aku.",
    "Kamu jujur kalau lagi nggak mood, bukan diem terus meledak.",
    "Cara kamu ngerapiin kerah baju aku tanpa diminta.",
    "Kamu nyimpen playlist yang isinya lagu-lagu kita.",
    "Kamu tetap manis walau baru bangun tidur dan belum cuci muka.",
    "Cara kamu bilang pelan-pelan aja pas aku panik.",
    "Kamu inget minuman favorit aku dan pesenin duluan.",
    "Kamu nggak pernah bosan dengerin aku cerita hal yang sama.",
    "Cara kamu ketawa sampai keluar suara aneh yang cuma aku tahu.",
    "Kamu bikin aku ngerasa rumah itu bukan tempat, tapi orang.",
    "Kamu semangatin aku pas gagal, bukan nanya kenapa bisa gagal.",
    "Cara kamu nulis pesan panjang pas hal penting susah diomongin.",
    "Kamu nanya pendapat aku walau udah punya keputusan sendiri.",
    "Kamu inget hari-hari kecil kita dan ngerayainnya diam-diam.",
    "Cara kamu ngeliat aku pas aku lagi sibuk sama hal lain.",
    "Kamu nggak pernah pergi tanpa pamit, sekecil apa pun.",
    "Kamu bikin versi paling jujur dari aku keluar tanpa takut.",
    "Cara kamu bilang iya udah, aku ngerti, dan beneran ngerti.",
    "Kamu inget aku suka kopi yang gimana, sampai takarannya.",
    "Kamu tetap ada pas orang lain cuma ada pas gampang.",
    "Cara kamu ngegenggam jaket aku pas kedinginan.",
    "Kamu nggak nge-judge hobi aku yang aneh-aneh.",
    "Kamu bikin aku betah pulang, bukan betah pergi.",
    "Cara kamu diam pas marah, lalu balik lagi kayak biasa.",
    "Kamu inget lagu yang aku putar di hari tertentu.",
    "Kamu percaya aku bahkan pas aku belum kasih alasan buat percaya.",
    "Cara kamu bilang aku bangga sama kamu di waktu yang pas.",
    "Kamu ngajarin aku sabar tanpa pernah ceramah.",
    "Kamu nyimpen hal-hal kecil yang aku kasih, walau nggak seberapa.",
    "Cara kamu narik napas dulu sebelum ngomong yang serius.",
    "Kamu bikin aku ngerasa dilihat, bukan cuma ditemani.",
    "Kamu inget aku alergi apa dan ngecek dulu sebelum pesan.",
    "Cara kamu nyandarin kepala ke bahu aku pas capek.",
    "Kamu nggak minta aku berubah, cuma minta aku jujur.",
    "Kamu tetap milih ketawa walau harinya berat.",
    "Cara kamu bilang nanti aku jemput, dan beneran dateng.",
    "Kamu inget nama teman-teman aku dan nanyain kabarnya.",
    "Kamu bikin rencana kecil buat kita, walau cuma jajan.",
    "Cara kamu ngerem candaan pas tahu aku lagi sensitif.",
    "Kamu maafin aku lebih cepat dari aku maafin diri sendiri.",
    "Kamu inget aku pengen ke mana suatu hari nanti.",
    "Cara kamu bilang aku di sini pas aku nggak tahu harus ngomong apa.",
    "Kamu bikin hal biasa terasa layak diinget.",
    "Kamu tetap sabar ngajarin aku hal yang buat kamu gampang.",
    "Cara kamu ngelirik aku dulu sebelum ketawa di keramaian.",
    "Kamu nyimpen chat pertama kita sampai sekarang.",
    "Kamu bikin aku ngerasa cukup, tanpa harus jadi siapa-siapa.",
    "Cara kamu bilang selamat pagi seolah itu kabar baik tiap hari.",
    "Kamu milih aku lagi, tiap hari, walau udah tahu semua kurangnya.",
    "Kamu bikin empat bulan terasa kayak awal dari sesuatu yang panjang."
  ],

  closing: "Dari yang mencintaimu.",
  footer: "Yukisnow Corp. · YS-004 · Ditekan dengan tangan, untuk satu pendengar."
};
