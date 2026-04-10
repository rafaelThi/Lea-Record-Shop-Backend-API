import {
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Disc } from './entities/disc.entity';
import { CreateDiscDto } from './dto/create-disc.dto';
import { UpdateDiscDto } from './dto/update-disc.dto';
import { FilterDiscDto } from './dto/filter-disc.dto';

@Injectable()
export class DiscService {
  constructor(
    @InjectRepository(Disc)
    private readonly discRepository: Repository<Disc>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async create(dto: CreateDiscDto): Promise<Disc> {
    const disc = this.discRepository.create(dto);
    const saved = await this.discRepository.save(disc);
    await this.syncStockToRedis(saved.id, saved.quantity);
    return saved;
  }

  async findAll(
    filter: FilterDiscDto,
  ): Promise<{ data: Disc[]; total: number; page: number; limit: number }> {
    const { name, artist, releaseYear, style, page, limit } = filter;

    const qb = this.discRepository.createQueryBuilder('disc');

    if (name) {
      qb.andWhere('LOWER(disc.name) LIKE LOWER(:name)', {
        name: `%${name}%`,
      });
    }

    if (artist) {
      qb.andWhere('LOWER(disc.artist) LIKE LOWER(:artist)', {
        artist: `%${artist}%`,
      });
    }

    if (releaseYear) {
      qb.andWhere('disc.release_year = :releaseYear', { releaseYear });
    }

    if (style) {
      qb.andWhere('disc.style = :style', { style });
    }

    qb.orderBy('disc.created_at', 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Disc> {
    const disc = await this.discRepository.findOne({ where: { id } });
    if (!disc) {
      throw new NotFoundException(`Disc with id ${id} not found`);
    }
    return disc;
  }

  async update(id: string, dto: UpdateDiscDto): Promise<Disc> {
    const disc = await this.findOne(id);
    Object.assign(disc, dto);
    const saved = await this.discRepository.save(disc);

    if (dto.quantity !== undefined) {
      await this.syncStockToRedis(saved.id, saved.quantity);
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const disc = await this.findOne(id);
    await this.discRepository.remove(disc);
    await this.redis.del(`stock:disc:${id}`);
  }

  async getStockFromRedis(discId: string): Promise<number> {
    const stock = await this.redis.get(`stock:disc:${discId}`);
    if (stock === null) {
      const disc = await this.findOne(discId);
      await this.syncStockToRedis(discId, disc.quantity);
      return disc.quantity;
    }
    return parseInt(stock, 10);
  }

  async syncStockToRedis(discId: string, quantity: number): Promise<void> {
    await this.redis.set(`stock:disc:${discId}`, quantity);
  }
}
