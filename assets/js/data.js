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
    "Aku nggak pinter nulis surat, jadi aku bikin yang ini aja. Anggap ini sisi A dari sesuatu yang aku harap panjang. Empat bulan, dua negara, dan entah kenapa berasa kayak kamu selalu deket.\n\n" +
    "Aku suka hal-hal kecil yang kamu nggak sadar kamu lakuin. Cara kamu tetep nyalain kamera walau udah ngantuk. Cara kamu bilang selamat malam padahal di aku belum malam. Aku ngerekam semuanya diam-diam, jadi ada di sini semua, jadi lagu, jadi track.\n\n" +
    "Jarak emang nggak gampang. Tapi tiap minggu kita bikin dunia sendiri: main game bareng, nonton bareng, makan bareng lewat layar. Aku janji bakal terus nekan tombol rekam, sampai kita nggak perlu layar lagi buat deket.\n\n" +
    "Makasih udah mau jadi pendengar satu-satunya, walau dari sejauh ini.",

  tracks: [
    { n: 1, title: "Ketemu di Dunia Maya", date: "2026-03-17", story: "Kita ketemu bukan di tempat, tapi di layar. Dan entah kenapa itu udah cukup buat aku.", photo: "", commentary: "", prompt: "Hai kamu. Nggak ada alasan, aku cuma lagi inget kamu. Aku sayang sama kamu." },
    { n: 2, title: "Obrolan yang Ngalir", date: "2026-03-24", story: "Obrolan pertama yang panjang, dari hal random sampai hal yang jarang aku cerita ke siapa-siapa. Sama kamu, semuanya ngalir aja.", photo: "", commentary: "", prompt: "Ngobrol sama kamu itu selalu ngalir. Aku suka sama kamu, dari dulu." },
    { n: 3, title: "Beda Dua Jam", date: "2026-03-31", story: "Aku di Jepang, kamu di Indonesia. Aku duluan dua jam. Jadi aku sering nungguin kamu nyusul ke jam yang sama.", photo: "", commentary: "", prompt: "Beda dua jam, tapi aku selalu nungguin kamu. Aku kangen sama kamu." },
    { n: 4, title: "It Takes Two", date: "2026-04-07", story: "Main It Takes Two bareng. Panik bareng pas puzzle-nya susah, terus ketawa lagi. Katanya game buat berdua — cocok.", photo: "", commentary: "", prompt: "Main berdua sama kamu itu favoritku. Aku nggak mau main sama siapa-siapa selain kamu." },
    { n: 5, title: "Overcooked, Kacau", date: "2026-04-14", story: "Overcooked bikin kita teriak-teriak. Dapur virtualnya berantakan, tapi ketawa kita nyata.", photo: "", commentary: "", prompt: "Kamu bikin hal kacau jadi lucu. Aku sayang kamu, apa adanya kamu." },
    { n: 6, title: "Moving Out", date: "2026-04-21", story: "Angkat-angkat sofa virtual bareng. Nggak efisien sama sekali, tapi seru. Kayak kita mindahin hidup pelan-pelan biar muat berdua.", photo: "", commentary: "", prompt: "Pelan-pelan kita mindahin hidup biar muat berdua. Aku cinta sama kamu." },
    { n: 7, title: "Nonton Anime Bareng", date: "2026-04-28", story: "Pencet play barengan, hitung mundur tiga-dua-satu. Nonton anime sambil komentar nggak jelas di chat.", photo: "", commentary: "", prompt: "Pencet play bareng ya. Aku suka nonton apa aja asal sama kamu." },
    { n: 8, title: "Makan Malam Berdua", date: "2026-05-05", story: "Makan malam bareng, tapi lewat layar. Kamu makan di jam kamu, aku di jam aku. Tetep berasa satu meja.", photo: "", commentary: "", prompt: "Makan malam bareng walau lewat layar. Selamat makan, sayang. Aku sayang kamu." },
    { n: 9, title: "Nonton Film, Ketiduran", date: "2026-05-12", story: "Niat nonton film sampai habis. Kamu ketiduran di tengah, aku biarin, nggak tega matiin call-nya.", photo: "", commentary: "", prompt: "Kamu ketiduran pas nonton, dan aku nggak tega nutup call-nya. Aku cinta kamu." },
    { n: 10, title: "Cerita Sampai Subuh", date: "2026-05-19", story: "Cerita apa aja sampai subuh. Hal kecil, hal random, hal yang cuma penting buat kita berdua.", photo: "", commentary: "", prompt: "Cerita sampai subuh sama kamu itu favorit aku. Aku jatuh cinta lagi sama kamu." },
    { n: 11, title: "Pagi dan Malam", date: "2026-05-26", story: "Kamu yang pertama aku kabarin pas bangun, dan yang terakhir sebelum tidur. Walau jamnya beda dua jam, ritmenya selalu ketemu.", photo: "", commentary: "", prompt: "Kamu yang pertama aku kabarin tiap bangun. Aku sayang kamu, tiap hari." },
    { n: 12, title: "Playlist Kita", date: "2026-06-02", story: "Mulai satu playlist isinya lagu-lagu kita. Tiap nambah lagu, kayak nambah satu kenangan.", photo: "", commentary: "", prompt: "Playlist kita makin panjang, kayak kita. Aku cinta sama kamu." },
    { n: 13, title: "Kangen yang Beda", date: "2026-06-09", story: "Kangen versi LDR itu beda. Bukan cuma pengen ketemu — pengen ada di zona waktu yang sama.", photo: "", commentary: "", prompt: "Kangen versi kita itu beda, pengen di zona waktu yang sama. Aku rindu sama kamu." },
    { n: 14, title: "Rencana Ketemu", date: "2026-06-16", story: "Mulai ngitung-ngitung. Kapan aku bisa ke sana, atau kamu ke sini. Belum pasti, tapi kita simpan mimpinya.", photo: "", commentary: "", prompt: "Nanti kita ketemu, aku janji. Aku punya kamu, dan itu udah cukup." },
    { n: 15, title: "Call yang Nggak Ditutup", date: "2026-06-30", story: "Salah satu malam, call-nya nggak ditutup sampai pagi. Cuma diem, kadang ngobrol. Berasa tidur bareng walau beda negara.", photo: "", commentary: "", prompt: "Malam ini call-nya nggak usah ditutup ya. Aku di sini. Aku sayang kamu." },
    { n: 16, title: "Bulan Keempat", date: "2026-07-17", story: "Empat bulan, dua negara, satu layar yang selalu nyala. Masih di sisi A, masih banyak yang mau kita rekam.", photo: "", commentary: "", prompt: "Empat bulan, dua negara, satu layar. Aku cinta sama kamu, sekarang dan nanti." }
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
    "Kepribadian kamu yang luar biasa dan penuh keindahan",
    "Senyuman kamu yang selalu bisa mencairkan hatiku",
    "Pemikiran kamu yang dalam, bijak, dan selalu mengejutkanku",
    "Kedewasaan kamu dalam menghadapi setiap situasi",
    "Caramu memandangku — seperti aku adalah seluruh duniamu",
    "Kesabaran kamu yang nyaris tak berbatas",
    "Keistimewaan kamu yang tak tertandingi oleh siapapun",
    "Kamu adalah sahabat terbaikku, sebelum menjadi cintaku",
    "Kamu mendengarkanku dengan tulus, tanpa menghakimi",
    "Sikap positif kamu yang selalu menularkan semangat",
    "Kamu sangat peduli — pada aku, pada orang lain, pada hal-hal kecil sekalipun",
    "Kamu adalah tempat ternyamanku di seluruh dunia ini",
    "Kamu adalah tempat teraman yang pernah aku temukan",
    "Kamu mendukung setiap impianku tanpa pernah ragu",
    "Kamu adalah penyemangat terbesar yang pernah aku miliki",
    "Cara kamu tertawa — tulus, lepas, dan selalu membuat hatiku ikut bahagia",
    "Kamu selalu hadir di saat aku paling membutuhkan, tanpa perlu aku minta",
    "Kamu membuatku menjadi versi terbaik dari diri aku sendiri",
    "Cara kamu mengungkapkan rasa peduli lewat tindakan kecil yang bermakna besar",
    "Ketulusan kamu dalam mencintai — tidak ada yang dibuat-buat",
    "Cara kamu memahami perasaanku bahkan sebelum aku mengucapkannya",
    "Matamu yang berbicara lebih banyak dari kata-kata manapun",
    "Kehangatan yang selalu bisa aku rasakan setiap kali bersamamu",
    "Cara kamu menyebut namaku — ada sesuatu yang berbeda saat kamu yang mengatakannya",
    "Kamu membuat hari-hari biasa terasa sangat luar biasa",
    "Kepekaan kamu terhadap perasaan orang lain yang selalu membuatku kagum",
    "Cara kamu mengingat hal-hal kecil yang penting bagiku",
    "Kamu tidak pernah lelah mendengar ceritaku, bahkan yang paling sepele sekalipun",
    "Kamu selalu jujur, bahkan ketika kejujuran itu tidak mudah",
    "Cara kamu memelukku — hangat, erat, dan selalu terasa seperti pulang ke rumah",
    "Kamu mengajarkan aku artinya benar-benar bersyukur",
    "Semangat kamu yang selalu berhasil menginspirasi aku untuk terus maju",
    "Cara kamu menghadapi masalah dengan kepala dingin dan hati yang tenang",
    "Kamu tidak pernah menyerah — pada diri sendiri, pada kita, pada keadaan",
    "Kemandirian kamu yang sangat aku kagumi dan banggakan",
    "Cara kamu tersenyum waktu setengah mengantuk — itu salah satu pemandangan terindah",
    "Kamu tahu persis kapan aku butuh ruang, dan kapan aku butuh dipeluk",
    "Cara kamu tetap lembut, bahkan di saat keadaan tidak memihak kamu sekalipun",
    "Kamu adalah orang yang paling aku percaya di seluruh dunia ini",
    "Cara kamu selalu melihat sisi baik dari setiap situasi, seberat apapun itu",
    "Kamu selalu mencoba memahami sudut pandang orang lain sebelum menghakimi",
    "Rasa ingin tahu kamu yang membuat percakapan kita tidak pernah membosankan",
    "Cara kamu berpikir — terstruktur, kreatif, dan selalu berhasil mengejutkanku",
    "Kamu tidak pernah membuat aku merasa sendirian, meski aku sedang jauh",
    "Selera humor kamu yang selalu bisa membuat aku senyum sendiri tiba-tiba",
    "Cara kamu mengambil keputusan — penuh pertimbangan namun tetap berani",
    "Kamu membuat aku berani bermimpi lebih besar dari yang pernah aku bayangkan",
    "Cara kamu merawat diri sendiri — aku belajar banyak tentang menghargai diri dari kamu",
    "Kamu mengajarkan aku bahwa cinta yang nyata tidak harus sempurna",
    "Cara kamu mengekspresikan diri — autentik, jujur, dan tanpa topeng apapun",
    "Kamu tidak pernah berpura-pura menjadi orang lain di depanku",
    "Cara kamu merawat hubungan kita dengan penuh perhatian dan kesungguhan",
    "Kepercayaan kamu padaku, bahkan di saat aku sendiri meragukan kemampuan diri",
    "Cara kamu bilang \"aku bangga sama kamu\" — selalu tepat di waktu yang paling aku butuhkan",
    "Kamu adalah alasan aku selalu pulang dengan hati yang lebih ringan",
    "Cara kamu berdebat — sehat, adil, dan tidak pernah menyakiti",
    "Kamu selalu mau belajar dan berkembang, tidak pernah merasa sudah cukup",
    "Cara kamu merayakan keberhasilan aku — seolah-olah itu adalah milikmu juga",
    "Kamu tidak pernah membuatku merasa kecil atau tidak cukup baik",
    "Cara kamu berterima kasih untuk hal-hal sekecil apapun — itu mengajarkanku banyak",
    "Kamu mengajarkan aku cara mencintai tanpa syarat dan tanpa hitungan",
    "Cara kamu menjaga kepercayaan — tidak pernah sekalipun aku meragukannya",
    "Kamu hadir sepenuhnya saat bersamaku — dunia luar bisa menunggu",
    "Cara kamu memperhatikan detail kecil tentang aku yang bahkan aku sendiri sering lupakan",
    "Kamu adalah cermin yang selalu menunjukkan sisi terbaik dari diri aku",
    "Cara kamu bilang \"aku di sini ya\" — sederhana, tapi selalu lebih dari cukup",
    "Kamu membuat diam di antara kita pun terasa nyaman dan tidak canggung",
    "Cara kamu mencintai hal-hal yang aku cintai, hanya karena aku mencintainya",
    "Kamu tidak pernah meremehkan atau mengecilkan perasaanku",
    "Cara kamu menghiburku — tidak selalu dengan solusi, tapi dengan kehadiran yang tulus",
    "Kamu adalah orang yang setiap harinya membuatku ingin menjadi lebih baik",
    "Cara kamu berkomitmen pada hal-hal yang kamu yakini — aku sangat menghormati itu",
    "Kamu selalu menghargai usahaku, sekecil dan sesederhana apapun itu",
    "Cara kamu menjaga perasaanku bahkan di saat kamu sendiri sedang tidak baik-baik saja",
    "Kamu mengajarkan aku bahwa kerentanan dan kejujuran adalah bentuk keberanian",
    "Cara kamu menatapku saat aku sedang berbicara — sepenuh hati, tanpa terganggu apapun",
    "Kamu adalah alasan di balik senyum terbaikku — yang tulus, bukan yang dipaksakan",
    "Cara kamu hadir secara emosional, tidak hanya secara fisik",
    "Kamu selalu mencari cara untuk membuat hariku lebih baik, bahkan dari hal terkecil",
    "Cara kamu memaafkan — tulus, tanpa menghitung-hitung, tanpa menyimpan dendam",
    "Kamu adalah orang pertama yang ingin aku hubungi saat ada berita baik maupun buruk",
    "Cara kamu menghargai dan mengapresiasi orang-orang di sekitar kamu",
    "Kamu membuat aku merasa dilihat, didengar, dan sungguh-sungguh dihargai",
    "Cara kamu tetap cantik bahkan saat sedang lelah atau sedang marah sekalipun",
    "Kamu mengajarkan aku seperti apa hubungan yang sehat dan nyata itu seharusnya",
    "Cara kamu mengucapkan namaku — ada resonansi yang berbeda yang tidak bisa aku jelaskan",
    "Kamu adalah satu-satunya orang yang bisa membuat aku tenang hanya dengan suaramu",
    "Cara kamu percaya pada proses — pada proses kita, pada waktu, pada perjalanan panjang ini",
    "Kamu adalah orang yang selalu ingin aku ajak menua bersama-sama",
    "Cara kamu mengingatkan aku untuk beristirahat saat aku terlalu keras pada diri sendiri",
    "Kamu tidak pernah membanding-bandingkan aku dengan siapapun — itu sangat berarti bagiku",
    "Cara kamu mencintai tanpa membuatku merasa terbatas atau terkekang",
    "Kamu adalah hadiah terbaik yang pernah diberikan kehidupan kepadaku",
    "Cara kamu tetap kuat dan tegar bahkan di saat kamu sendiri juga sedang berjuang",
    "Kamu membuatku percaya bahwa sesuatu yang indah dan nyata itu sungguh-sungguh ada",
    "Cara kamu memilih untuk tetap ada — setiap hari, dengan sadar, dengan penuh cinta",
    "Kamu membuat aku tidak takut lagi menghadapi masa depan, karena aku tahu kamu ada",
    "Cara kamu menaruh kepercayaan padaku — itu tanggung jawab yang aku pegang dengan sepenuh hati",
    "Kamu bukan hanya pacar aku — kamu adalah rumah yang selalu aku rindukan",
    "Dan setiap hari, aku menemukan satu alasan baru untuk semakin dalam mencintaimu"
  ],

  closing: "Dari yang mencintaimu.",
  footer: "Kamu dan Aku · YS-004 · Ditekan dengan tangan, untuk satu pendengar."
};
