import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { DiscService } from './disc.service';
import { Disc } from './entities/disc.entity';
import { DiscStyle } from './enums/disc-style.enum';
import { CreateDiscDto } from './dto/create-disc.dto';

describe('DiscService', () => {
  let service: DiscService;
  let repository: jest.Mocked<Partial<Repository<Disc>>>;
  let redis: Record<string, jest.Mock>;

  const mockDisc: Partial<Disc> = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'We are Reactive',
    artist: 'Hohpe',
    releaseYear: 2026,
    style: DiscStyle.INDIE,
    quantity: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn().mockReturnValue(mockDisc),
      save: jest.fn().mockResolvedValue(mockDisc),
      findOne: jest.fn().mockResolvedValue(mockDisc),
      remove: jest.fn().mockResolvedValue(mockDisc),
      createQueryBuilder: jest.fn().mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockDisc], 1]),
      }),
    };

    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('500'),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscService,
        { provide: getRepositoryToken(Disc), useValue: repository },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    }).compile();

    service = module.get<DiscService>(DiscService);
  });

  describe('create', () => {
    it('should create a disc and sync stock to Redis', async () => {
      const dto: CreateDiscDto = {
        name: 'We are Reactive',
        artist: 'Hohpe',
        releaseYear: 2026,
        style: DiscStyle.INDIE,
        quantity: 500,
      };

      const result = await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith(dto);
      expect(repository.save).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        `stock:disc:${mockDisc.id}`,
        500,
      );
      expect(result).toEqual(mockDisc);
    });
  });

  describe('findAll', () => {
    it('should return paginated discs with filters', async () => {
      const result = await service.findAll({
        name: 'Reactive',
        artist: 'Hohpe',
        style: DiscStyle.INDIE,
        page: 1,
        limit: 20,
      });

      expect(result.data).toEqual([mockDisc]);
      expect(result.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return a disc by id', async () => {
      const result = await service.findOne(mockDisc.id!);
      expect(result).toEqual(mockDisc);
    });

    it('should throw NotFoundException if disc not found', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a disc and sync stock if quantity changed', async () => {
      const updated = { ...mockDisc, quantity: 300 };
      repository.save!.mockResolvedValue(updated as Disc);

      const result = await service.update(mockDisc.id!, { quantity: 300 });

      expect(redis.set).toHaveBeenCalledWith(
        `stock:disc:${mockDisc.id}`,
        300,
      );
      expect(result.quantity).toBe(300);
    });
  });

  describe('remove', () => {
    it('should remove a disc and delete Redis stock key', async () => {
      await service.remove(mockDisc.id!);

      expect(repository.remove).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith(`stock:disc:${mockDisc.id}`);
    });
  });

  describe('getStockFromRedis', () => {
    it('should return stock from Redis', async () => {
      const stock = await service.getStockFromRedis(mockDisc.id!);
      expect(stock).toBe(500);
    });

    it('should fallback to DB and sync Redis if key missing', async () => {
      redis.get.mockResolvedValue(null);
      repository.findOne!.mockResolvedValue(mockDisc as Disc);
      const stock = await service.getStockFromRedis(mockDisc.id!);
      expect(stock).toBe(mockDisc.quantity);
      expect(redis.set).toHaveBeenCalled();
    });
  });
});
