import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { SqlPool } from '@let-it-be/db';

const ttlMs = 10 * 60_000;
export type StaffRole = 'OWNER' | 'OPERATIONS' | 'PREPRESS' | 'READ_ONLY';
export interface StaffSession { id: string; staffMemberId: string; email: string; role: StaffRole; expiresAt: Date; token: string }

export class StaffAuthenticationError extends Error {}

export class StaffIdentityService {
  constructor(private readonly pool: SqlPool, private readonly options: { pepper: string; initialOwnerEmail?: string }) {}
  async requestCode(email: string): Promise<void> {
    const normalized = normalize(email); const hash = digest(normalized);
    const eligible = await this.pool.query<{ id: string }>(`SELECT id FROM app.staff_members WHERE normalized_email=$1 AND status IN ('INVITED','ACTIVE')`, [normalized]);
    if (!eligible.rows[0] && normalized !== this.options.initialOwnerEmail) return;
    const code = String(randomInt(100_000, 1_000_000)); const expiresAt = new Date(Date.now() + ttlMs);
    await this.pool.query(`UPDATE app.staff_email_challenges SET consumed_at=now() WHERE email_hash=$1 AND consumed_at IS NULL`, [hash]);
    await this.pool.query(`INSERT INTO app.staff_email_challenges (email_hash,code_hash,expires_at) VALUES ($1,$2,$3)`, [hash, codeHash(normalized, code, this.options.pepper), expiresAt]);
    console.info(JSON.stringify({ event: 'development.staff_email_code_delivered', email: normalized, code, expiresAt: expiresAt.toISOString() }));
  }
  async verifyCode(email: string, code: string): Promise<StaffSession> {
    const normalized = normalize(email); const challenge = await this.pool.query<{ id:string;code_hash:string;expires_at:Date;attempt_count:number }>(`SELECT id,code_hash,expires_at,attempt_count FROM app.staff_email_challenges WHERE email_hash=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, [digest(normalized)]);
    const row=challenge.rows[0]; if(!row || !/^\d{6}$/.test(code) || row.expires_at <= new Date() || row.attempt_count >= 5 || !safeEqual(row.code_hash, codeHash(normalized,code,this.options.pepper))) { if(row) await this.pool.query(`UPDATE app.staff_email_challenges SET attempt_count=attempt_count+1 WHERE id=$1`,[row.id]); throw new StaffAuthenticationError('The code is invalid or has expired.'); }
    await this.pool.query(`UPDATE app.staff_email_challenges SET consumed_at=now() WHERE id=$1`,[row.id]);
    let member = await this.pool.query<{id:string;role:StaffRole;status:string}>(`SELECT id,role,status FROM app.staff_members WHERE normalized_email=$1`,[normalized]);
    if(!member.rows[0] && normalized===this.options.initialOwnerEmail) member=await this.pool.query(`INSERT INTO app.staff_members (normalized_email,role,status,activated_at) VALUES ($1,'OWNER','ACTIVE',now()) RETURNING id,role,status`,[normalized]);
    const staff=member.rows[0]; if(!staff || staff.status==='SUSPENDED') throw new StaffAuthenticationError('Staff access is unavailable.');
    if(staff.status==='INVITED') await this.pool.query(`UPDATE app.staff_members SET status='ACTIVE',activated_at=now(),updated_at=now() WHERE id=$1`,[staff.id]);
    const token=randomBytes(32).toString('base64url'); const created=await this.pool.query<{id:string;expires_at:Date}>(`INSERT INTO app.staff_sessions (staff_member_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '12 hours') RETURNING id,expires_at`,[staff.id,digest(token)]);
    await this.pool.query(`INSERT INTO app.staff_audit_events (staff_member_id,event_type) VALUES ($1,'SIGNED_IN')`, [staff.id]);
    return {id:created.rows[0]!.id,staffMemberId:staff.id,email:normalized,role:staff.role,expiresAt:created.rows[0]!.expires_at,token};
  }
  async getSession(token:string):Promise<Omit<StaffSession,'token'>|null>{const r=await this.pool.query<{id:string;staff_member_id:string;normalized_email:string;role:StaffRole;expires_at:Date}>(`UPDATE app.staff_sessions s SET last_seen_at=now() FROM app.staff_members m WHERE s.staff_member_id=m.id AND s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND m.status='ACTIVE' RETURNING s.id,s.staff_member_id,m.normalized_email,m.role,s.expires_at`,[digest(token)]);const x=r.rows[0];return x?{id:x.id,staffMemberId:x.staff_member_id,email:x.normalized_email,role:x.role,expiresAt:x.expires_at}:null;}
  async revokeSession(token: string): Promise<void> {
    await this.pool.query(`UPDATE app.staff_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, [digest(token)]);
  }
}
function normalize(v:string){const e=v.trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(e))throw new StaffAuthenticationError('Enter a valid email address.');return e}function digest(v:string){return createHash('sha256').update(v).digest('hex')}function codeHash(e:string,c:string,p:string){return createHmac('sha256',p).update(`${e}:${c}`).digest('hex')}function safeEqual(a:string,b:string){const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex');return x.length===y.length&&timingSafeEqual(x,y)}
