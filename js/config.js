// ============================================================
//  CONFIGURAÇÃO DO SISTEMA BORGES MOTOS
// ============================================================

// 1) FIREBASE — cole aqui a configuração do seu projeto
//    (Console Firebase > ⚙ Configurações do projeto > Seus apps > Web > "Configuração").
//    Enquanto estiver null, o sistema roda em MODO LOCAL: os dados ficam só
//    neste navegador (serve para testar).
export const FIREBASE = {
  apiKey: "AIzaSyDojImvQZS07K7m1sjId0cmDwwceXP6umg",
  authDomain: "borges-motos.firebaseapp.com",
  projectId: "borges-motos",
  storageBucket: "borges-motos.firebasestorage.app",
  messagingSenderId: "289107272412",
  appId: "1:289107272412:web:ff833d4b3eedcee65eca19"
};
/* Exemplo:
export const FIREBASE = {
  apiKey: "AIza...",
  authDomain: "borges-motos.firebaseapp.com",
  projectId: "borges-motos",
  storageBucket: "borges-motos.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
*/

// 2) E-MAIL DA CONTA ÚNICA DA OFICINA (criada no Firebase > Authentication).
//    Na tela de login só a senha é pedida.
export const EMAIL_LOGIN = 'borgesmotos3800@gmail.com';

// Limite anual do MEI (usado na barra da aba Contas).
export const LIMITE_MEI = 81000;

// 3) SERVIÇOS — número, nome e preço padrão (null = valor variável, digitado na hora).
export const SERVICOS = {
  1: { nome: 'RETÍFICA',       preco: 40 },
  2: { nome: 'TROCA DE BIELA', preco: 40 },
  3: { nome: 'CABEÇOTE',       preco: 40 },
  4: { nome: 'ZINCAGEM',       preco: null },
  5: { nome: 'PEÇAS',          preco: null },
  6: { nome: 'SERVIÇOS',       preco: null },
};
